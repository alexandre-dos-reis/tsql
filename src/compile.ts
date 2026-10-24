import {
  NodeFlags,
  SyntaxKind,
  type ArrowFunction,
  type FunctionDeclaration,
  type Identifier,
  type SourceFile,
  type VariableStatement,
} from "typescript/unstable/ast";
import { dirname, relative, resolve } from "node:path";
import { CompileError } from "./errors.ts";
import { emitMigration, type EmitOptions } from "./emit.ts";
import type { CompositeType, FunctionIR, PgType, SignatureIR } from "./ir.ts";
import { isExported, lowerFunction, lowerSignature, type RuleFunction } from "./lower.ts";
import { openProject, typeCheck } from "./program.ts";

export interface CompileOptions {
  /** tsconfig of the project holding the business rules. */
  readonly tsconfig: string;
  /** Restrict compilation to specific files (used by tests). */
  readonly include?: (fileName: string) => boolean;
  /**
   * Restrict compilation to these files, named by the caller.
   *
   * Unlike `include`, every path here must turn out to be a file the project
   * actually holds. A name that matches nothing is an error rather than an
   * empty build: silently compiling no rules because a path was misspelled is
   * the sort of quiet wrongness this compiler exists to refuse.
   */
  readonly files?: readonly string[];
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
  readonly generatedBy: "tsql";
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

    const ctx = { project, checker: project.checker, composites, mapping: new Set<string>() };
    const files = await rulesFiles(project, projectRoot, options);

    // Pass 1: every signature, so call checking does not depend on file order.
    const signatures = new Map<string, SignatureIR>();
    const pending: { fn: RuleFunction; signature: SignatureIR; module: string }[] = [];
    const claimed = new Map<string, string>();

    for (const file of files) {
      for (const fn of exportedRules(file, errors)) {
        try {
          const signature = await lowerSignature(fn, ctx);
          const previous = claimed.get(signature.sqlName);
          if (previous) {
            errors.push(
              CompileError.at(
                fn.name,
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
        generatedBy: "tsql",
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
  return { generatedBy: "tsql", schema: options.emit?.schema ?? null, types: [], functions: [] };
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
  // A composite's array fields bring their element types with them.
  const collect = (type: PgType): void => {
    if (type.kind === "array") return collect(type.element);
    if (type.kind !== "composite" || names.has(type.sqlName)) return;
    names.add(type.sqlName);
    for (const field of type.fields) collect(field.type);
  };
  for (const fn of functions) {
    for (const type of [...fn.params.map((p) => p.type), fn.returns, ...fn.locals.map((l) => l.type)]) collect(type);
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
  options: CompileOptions,
): Promise<SourceFile[]> {
  const inProject = (await project.program.getSourceFileNames())
    .filter((name) => !name.endsWith(".d.ts") && !name.includes("node_modules"))
    .filter((name) => resolve(name).startsWith(`${projectRoot}/`));

  const requested = selected(inProject, options);
  const names = inProject
    .filter((name) => requested?.has(resolve(name)) ?? true)
    .filter((name) => options.include?.(name) ?? true)
    .sort();

  const files: SourceFile[] = [];
  for (const name of names) {
    const file = await project.program.getSourceFile(name);
    if (file) files.push(file);
  }
  return files;
}

/**
 * The named files, checked against what the project holds.
 *
 * `undefined` means "no selection, compile everything". A name that is not one
 * of the project's own rule files is rejected here, where the reason can still
 * be explained — the alternative is a build that reports success having
 * translated nothing.
 */
function selected(inProject: readonly string[], options: CompileOptions): Set<string> | undefined {
  if (!options.files || options.files.length === 0) return undefined;

  const available = new Set(inProject.map((name) => resolve(name)));
  const wanted = new Set<string>();
  for (const file of options.files) {
    const path = resolve(file);
    if (!available.has(path)) {
      const where = relative(process.cwd(), path);
      const known = [...available]
        .map((name) => `  ${relative(process.cwd(), name)}`)
        .sort()
        .join("\n");
      throw new Error(
        `\`${where}\` is not a rule file in ${relative(process.cwd(), options.tsconfig)}.\n\n` +
          `The project holds:\n\n${known}\n`,
      );
    }
    wanted.add(path);
  }
  return wanted;
}

/**
 * The rules in a file: exported `function` declarations, and exported `const`s
 * bound to an arrow function. Other exported values (a number, a string) are
 * not rules and are left alone. An exported function written any other way —
 * a `let` or `var` binding, a `function` expression — would otherwise be
 * skipped without a word, so it is refused instead.
 */
function exportedRules(file: SourceFile, errors: CompileError[]): RuleFunction[] {
  const rules: RuleFunction[] = [];
  for (const statement of file.statements) {
    if (!isExported(statement)) continue;

    if (statement.kind === SyntaxKind.FunctionDeclaration) {
      const fn = statement as FunctionDeclaration;
      if (fn.name) rules.push({ name: fn.name, fn });
      else errors.push(CompileError.at(fn, "Anonymous functions cannot be compiled."));
      continue;
    }

    if (statement.kind !== SyntaxKind.VariableStatement) continue;
    const list = (statement as VariableStatement).declarationList;
    for (const declaration of list.declarations) {
      const init = declaration.initializer;
      if (!init) continue;
      const isFunction = init.kind === SyntaxKind.ArrowFunction || init.kind === SyntaxKind.FunctionExpression;
      if (!isFunction) continue;

      const label = declaration.name.kind === SyntaxKind.Identifier ? (declaration.name as Identifier).text : "this";
      if (init.kind === SyntaxKind.FunctionExpression) {
        errors.push(
          CompileError.at(
          init,
            `Write \`${label}\` as a \`function\` declaration or an arrow function; \`function\` expressions are not compiled.`,
          ),
        );
        continue;
      }
      if (!(list.flags & NodeFlags.Const)) {
        errors.push(
          CompileError.at(
            declaration,
            `Export \`${label}\` with \`const\`: a \`let\` or \`var\` binding can be reassigned, so it is not a fixed rule.`,
          ),
        );
        continue;
      }
      if (declaration.name.kind !== SyntaxKind.Identifier) {
        errors.push(CompileError.at(declaration.name, "Destructuring is not supported."));
        continue;
      }
      rules.push({ name: declaration.name as Identifier, fn: init as ArrowFunction });
    }
  }
  return rules;
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
