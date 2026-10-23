import { SyntaxKind, type FunctionDeclaration, type SourceFile } from "typescript/unstable/ast";
import { dirname, relative, resolve } from "node:path";
import { CompileError } from "./errors.ts";
import { emitMigration, type EmitOptions } from "./emit.ts";
import type { CompositeType, FunctionIR, PgType, SignatureIR } from "./ir.ts";
import { isExported, lowerFunction, lowerSignature } from "./lower.ts";
import { openProject, typeCheck } from "./program.ts";

export interface CompileOptions {
  /** tsconfig of the project holding the business rules. */
  readonly tsconfig: string;
  /** Restrict compilation to specific files (used by tests). */
  readonly include?: (fileName: string) => boolean;
  readonly emit?: EmitOptions;
}

export interface ManifestFunction {
  readonly tsName: string;
  readonly sqlName: string;
  readonly module: string;
  readonly params: readonly { readonly tsName: string; readonly sqlName: string; readonly type: PgType }[];
  readonly returns: PgType;
}

export interface Manifest {
  readonly generatedBy: "ts-to-plpgsql";
  readonly schema: string | null;
  readonly types: readonly CompositeType[];
  readonly functions: readonly ManifestFunction[];
}

export interface CompileResult {
  readonly ok: boolean;
  readonly functions: readonly FunctionIR[];
  readonly composites: readonly CompositeType[];
  readonly sql: string;
  readonly manifest: Manifest;
  /** Constructs this compiler refuses to translate. */
  readonly errors: readonly CompileError[];
  /** Errors from `tsc` itself. */
  readonly diagnostics: readonly string[];
}

/**
 * The pipeline: parse, type check, resolve types, reject what cannot be
 * preserved, lower, emit.
 */
export async function compileProject(options: CompileOptions): Promise<CompileResult> {
  const tsconfig = resolve(options.tsconfig);
  const projectRoot = dirname(tsconfig);
  const opened = await openProject(tsconfig);
  const errors: CompileError[] = [];
  // Composite types are discovered while mapping signatures, and shared across
  // the whole build so one `CREATE TYPE` is emitted per named object type.
  const composites = new Map<string, CompositeType>();

  try {
    const { project } = opened;
    const diagnostics = await typeCheck(project);
    if (diagnostics.length > 0) {
      return {
        ok: false,
        functions: [],
        composites: [],
        sql: "",
        manifest: emptyManifest(options),
        errors: [],
        diagnostics,
      };
    }

    const ctx = { project, checker: project.checker, composites };
    const files = await rulesFiles(project, projectRoot, options.include);

    // Pass 1: every signature, so call checking does not depend on file order.
    const signatures = new Map<string, SignatureIR>();
    const pending: { fn: FunctionDeclaration; signature: SignatureIR; module: string }[] = [];
    const claimed = new Map<string, string>();

    for (const file of files) {
      for (const fn of exportedFunctions(file)) {
        try {
          const signature = await lowerSignature(fn, ctx);
          const previous = claimed.get(signature.sqlName);
          if (previous) {
            errors.push(
              CompileError.at(
                fn.name ?? fn,
                `\`${signature.tsName}\` maps to SQL name \`${signature.sqlName}\`, which is already used by \`${previous}\`.`,
              ),
            );
            continue;
          }
          claimed.set(signature.sqlName, signature.tsName);
          signatures.set(signature.tsName, signature);
          pending.push({ fn, signature, module: relative(process.cwd(), file.fileName) });
        } catch (error) {
          errors.push(asCompileError(error));
        }
      }
    }

    // Pass 2: bodies.
    const functions: FunctionIR[] = [];
    for (const { fn, signature, module } of pending) {
      try {
        functions.push(await lowerFunction(fn, signature, module, signatures, ctx));
      } catch (error) {
        errors.push(asCompileError(error));
      }
    }

    const ok = errors.length === 0;
    const used = usedComposites(functions, composites);
    return {
      ok,
      functions,
      composites: used,
      sql: ok ? emitMigration(functions, used, options.emit) : "",
      manifest: {
        generatedBy: "ts-to-plpgsql",
        schema: options.emit?.schema ?? null,
        types: used,
        functions: functions.map((fn) => ({
          tsName: fn.tsName,
          sqlName: fn.sqlName,
          module: fn.module,
          params: fn.params.map((p) => ({ tsName: p.tsName, sqlName: p.sqlName, type: p.type })),
          returns: fn.returns,
        })),
      },
      errors,
      diagnostics: [],
    };
  } finally {
    await opened.close();
  }
}

function emptyManifest(options: CompileOptions): Manifest {
  return { generatedBy: "ts-to-plpgsql", schema: options.emit?.schema ?? null, types: [], functions: [] };
}

/**
 * Only emit types that a compiled function actually mentions: a signature that
 * failed to lower should not leave a `CREATE TYPE` behind.
 */
function usedComposites(
  functions: readonly FunctionIR[],
  discovered: ReadonlyMap<string, CompositeType>,
): CompositeType[] {
  const names = new Set<string>();
  for (const fn of functions) {
    for (const type of [...fn.params.map((p) => p.type), fn.returns, ...fn.locals.map((l) => l.type)]) {
      if (type.kind === "composite") names.add(type.sqlName);
    }
  }
  return [...names].sort().flatMap((name) => {
    const composite = discovered.get(name);
    return composite ? [composite] : [];
  });
}

/** Only files inside the rules project are compiled; imported helpers are not. */
async function rulesFiles(
  project: Awaited<ReturnType<typeof openProject>>["project"],
  projectRoot: string,
  include?: (fileName: string) => boolean,
): Promise<SourceFile[]> {
  const names = (await project.program.getSourceFileNames())
    .filter((name) => !name.endsWith(".d.ts") && !name.includes("node_modules"))
    .filter((name) => resolve(name).startsWith(`${projectRoot}/`))
    .filter((name) => include?.(name) ?? true)
    .sort();

  const files: SourceFile[] = [];
  for (const name of names) {
    const file = await project.program.getSourceFile(name);
    if (file) files.push(file);
  }
  return files;
}

function* exportedFunctions(file: SourceFile): Generator<FunctionDeclaration> {
  for (const statement of file.statements) {
    if (statement.kind !== SyntaxKind.FunctionDeclaration) continue;
    if (!isExported(statement)) continue;
    yield statement as FunctionDeclaration;
  }
}

function asCompileError(error: unknown): CompileError {
  if (error instanceof CompileError) return error;
  throw error;
}

export function formatResult(result: CompileResult, root = process.cwd()): string {
  const lines: string[] = [];
  for (const diagnostic of result.diagnostics) lines.push(diagnostic);
  for (const error of result.errors) lines.push(error.format(root));
  return lines.join("\n");
}
