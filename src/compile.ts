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
import { TSQL_SCHEMA } from "./helpers.ts";
import type { Paint } from "./style.ts";
import { emitMigration, type EmitOptions } from "./emit.ts";
import type { CompositeType, FunctionIR, NamedText, PgType, SignatureIR } from "./ir.ts";
import { isExported, lowerFunction, lowerSignature, type ExportedFunction } from "./lower/index.ts";
import { openProject, typeCheck } from "./program.ts";
import { chooseLanguages } from "./language.ts";
import { mapTypeDeclaration, type TypeDeclaration } from "./typemap/index.ts";

export interface CompileOptions {
  /**
   * A tsconfig whose settings and paths to use. Optional: without one, the
   * `files` are the project. Either way tsql imposes its `FORCED_OPTIONS`.
   */
  readonly tsconfig?: string;
  /** Restrict compilation to specific files (used by tests). */
  readonly include?: (fileName: string) => boolean;
  /**
   * Restrict compilation to these files, named by the caller.
   *
   * Unlike `include`, every path here must turn out to be a file the project
   * actually holds. A name that matches nothing is an error rather than an
   * empty build: silently compiling no functions because a path was misspelled is
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
  /** The domains and enums the functions use. */
  readonly named: readonly NamedText[];
  readonly functions: readonly ManifestFunction[];
}

export interface CompileResult {
  readonly ok: boolean;
  readonly functions: readonly FunctionIR[];
  readonly composites: readonly CompositeType[];
  readonly named: readonly NamedText[];
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
  if (options.emit?.schema === TSQL_SCHEMA) {
    throw new Error(
      `The schema \`${TSQL_SCHEMA}\` is reserved: tsql installs its own helper functions there (\`${TSQL_SCHEMA}.math_round\`…). Pick another schema for your functions.`,
    );
  }
  // With a tsconfig, only files under its directory are the project's own;
  // without one, the files named are the project.
  const projectRoot = options.tsconfig === undefined ? undefined : dirname(resolve(options.tsconfig));
  const opened = await openProject({
    ...(options.tsconfig === undefined ? {} : { tsconfig: options.tsconfig }),
    ...(options.files === undefined ? {} : { files: options.files }),
  });
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
        named: [],
        sql: "",
        manifest: emptyManifest(options),
        errors: [],
        diagnostics,
      };
    }

    const files = await sourceFiles(project, projectRoot, options);
    const compiled = new Set(files.map((file) => resolve(file.fileName)));
    const ctx = {
      project,
      checker: project.checker,
      composites,
      mapping: new Set<string>(),
      named: new Map<string, NamedText>(),
      compiled,
    };

    // Pass 1: every signature, so call checking does not depend on file order.
    const signatures = new Map<string, SignatureIR>();
    const pending: { fn: ExportedFunction; signature: SignatureIR; module: string }[] = [];
    const claimed = new Map<string, string>();

    for (const file of files) {
      for (const fn of exportedFunctions(file, errors)) {
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
    const lowered: FunctionIR[] = [];
    for (const { fn, signature, module } of pending) {
      try {
        lowered.push(await lowerFunction(fn, signature, module, signatures, ctx));
      } catch (error) {
        errors.push(asCompileError(error));
      }
    }
    // Every function is known now, so which can be a SQL function (see `src/language.ts`) can be told.
    const functions = chooseLanguages(lowered);

    // Pass 3: the exported types, mapped for their own sake. A type exported
    // from a compiled file belongs to the schema whether or not a function
    // mentions it — its only user may be a table column, written in SQL this
    // compiler never sees. Last, so a type reached from a parameter is still
    // reported at that parameter.
    const declared: PgType[] = [];
    for (const file of files) {
      for (const declaration of exportedTypes(file)) {
        try {
          declared.push(await mapTypeDeclaration(declaration, ctx));
        } catch (error) {
          errors.push(asCompileError(error));
        }
      }
    }

    const ok = errors.length === 0;
    const { composites: used, named } = usedTypes(functions, declared, composites);
    return {
      ok,
      functions,
      composites: used,
      named,
      sql: ok ? emitMigration(functions, used, options.emit, named) : "",
      manifest: {
        generatedBy: "tsql",
        schema: options.emit?.schema ?? null,
        types: used,
        named,
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
  return { generatedBy: "tsql", schema: options.emit?.schema ?? null, types: [], named: [], functions: [] };
}

/**
 * The types this migration creates: the ones a compiled function mentions, and
 * the ones a compiled file exports.
 *
 * A function's types are collected from its lowered IR rather than from
 * everything mapping discovered, so a signature that failed to lower does not
 * leave a `CREATE TYPE` behind. An exported type stands on its own, which is
 * what lets a table column be a composite's only user.
 */
function usedTypes(
  functions: readonly FunctionIR[],
  declared: readonly PgType[],
  discovered: ReadonlyMap<string, CompositeType>,
): { composites: CompositeType[]; named: NamedText[] } {
  const names = new Set<string>();
  const named = new Map<string, NamedText>();
  // A composite's fields bring their own types with them: the elements of an
  // array field, a field that is a domain or an enum.
  const collect = (type: PgType): void => {
    if (type.kind === "array") return collect(type.element);
    if (type.kind === "scalar") {
      if (type.named) named.set(type.named.sqlName, type.named);
      return;
    }
    if (names.has(type.sqlName)) return;
    names.add(type.sqlName);
    for (const field of type.fields) collect(field.type);
  };
  for (const fn of functions) {
    for (const type of [...fn.params.map((p) => p.type), fn.returns, ...fn.locals.map((l) => l.type)]) collect(type);
  }
  for (const type of declared) collect(type);
  return {
    composites: [...names].sort().flatMap((name) => {
      const composite = discovered.get(name);
      return composite ? [composite] : [];
    }),
    named: [...named.values()].sort((a, b) => a.sqlName.localeCompare(b.sqlName)),
  };
}

/** Only files inside the functions project are compiled; imported helpers are not. */
async function sourceFiles(
  project: Awaited<ReturnType<typeof openProject>>["project"],
  projectRoot: string | undefined,
  options: CompileOptions,
): Promise<SourceFile[]> {
  const inProject = (await project.program.getSourceFileNames())
    .filter((name) => !name.endsWith(".d.ts") && !name.includes("node_modules"))
    .filter((name) => projectRoot === undefined || resolve(name).startsWith(`${projectRoot}/`));

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
 * of the project's own source files is rejected here, where the reason can still
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
        `\`${where}\` is not a source file in ${options.tsconfig === undefined ? "this build" : relative(process.cwd(), options.tsconfig)}.\n\n` +
          `The project holds:\n\n${known}\n`,
      );
    }
    wanted.add(path);
  }
  return wanted;
}

/**
 * The type declarations a file exports: `interface`, `type` and `enum`.
 *
 * `export` is the whole rule, and the only place in this compiler where it
 * means something for a type: a type a function uses is mapped whether it is
 * exported or not, and exporting one asks for it in the schema on top of that.
 */
function exportedTypes(file: SourceFile): TypeDeclaration[] {
  const types: TypeDeclaration[] = [];
  for (const statement of file.statements) {
    if (!isExported(statement)) continue;
    switch (statement.kind) {
      case SyntaxKind.InterfaceDeclaration:
      case SyntaxKind.TypeAliasDeclaration:
      case SyntaxKind.EnumDeclaration:
        types.push(statement as TypeDeclaration);
        break;
      default:
        break;
    }
  }
  return types;
}

/**
 * The functions in a file: exported `function` declarations, and exported `const`s
 * bound to an arrow function. Other exported values (a number, a string) are
 * not functions and are left alone. An exported function written any other way —
 * a `let` or `var` binding, a `function` expression — would otherwise be
 * skipped without a word, so it is refused instead.
 */
function exportedFunctions(file: SourceFile, errors: CompileError[]): ExportedFunction[] {
  const functions: ExportedFunction[] = [];
  for (const statement of file.statements) {
    if (!isExported(statement)) continue;

    if (statement.kind === SyntaxKind.FunctionDeclaration) {
      const fn = statement as FunctionDeclaration;
      if (fn.name) functions.push({ name: fn.name, fn });
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
            `Export \`${label}\` with \`const\`: a \`let\` or \`var\` binding can be reassigned, so it is not a fixed function.`,
          ),
        );
        continue;
      }
      if (declaration.name.kind !== SyntaxKind.Identifier) {
        errors.push(CompileError.at(declaration.name, "Destructuring is not supported."));
        continue;
      }
      functions.push({ name: declaration.name as Identifier, fn: init as ArrowFunction });
    }
  }
  return functions;
}

function asCompileError(error: unknown): CompileError {
  if (error instanceof CompileError) return error;
  throw error;
}

export function formatResult(result: CompileResult, root = process.cwd(), paint?: Paint): string {
  const lines: string[] = [];
  for (const diagnostic of result.diagnostics) lines.push(diagnostic);
  for (const error of result.errors) lines.push(error.format(root, paint));
  return lines.join("\n");
}
