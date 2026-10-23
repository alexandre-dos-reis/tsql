import type { Node } from "typescript/unstable/ast";

/*
 * Fields are declared and assigned rather than written as constructor
 * parameter properties. Parameter properties *generate* assignments, so they
 * are not erasable syntax, and Node refuses to run a file containing them
 * without a transform. `erasableSyntaxOnly` in tsconfig.json keeps it that way.
 */

/**
 * An unsupported-construct rejection, carrying a source position so the build
 * failure reads like a compiler error rather than a stack trace.
 */
export class CompileError extends Error {
  readonly fileName: string;
  readonly line: number;
  readonly column: number;
  readonly sourceLine?: string;

  constructor(message: string, fileName: string, line: number, column: number, sourceLine?: string) {
    super(message);
    this.name = "CompileError";
    this.fileName = fileName;
    this.line = line;
    this.column = column;
    this.sourceLine = sourceLine;
  }

  static at(node: Node, message: string): CompileError {
    const file = node.getSourceFile();
    const { line, character } = file.getLineAndCharacterOfPosition(node.getStart(file));
    const text = file.text.split("\n")[line];
    return new CompileError(message, file.fileName, line + 1, character + 1, text);
  }

  format(root = process.cwd()): string {
    const where = this.fileName.startsWith(root) ? this.fileName.slice(root.length + 1) : this.fileName;
    const head = `${where}:${this.line}:${this.column} - ${this.message}`;
    if (this.sourceLine === undefined) return head;
    const gutter = String(this.line).padStart(5);
    return `${head}\n\n${gutter} | ${this.sourceLine}\n${" ".repeat(5)} | ${" ".repeat(this.column - 1)}^\n`;
  }
}

/**
 * The rules project could not be opened.
 *
 * Distinct from a plain `Error` so the CLI can add advice about `--project`
 * without the library having to know that a CLI exists — the default path
 * describes a *consuming* project, so this is what a first run usually hits.
 */
export class ProjectNotFoundError extends Error {
  readonly tsconfigPath: string;

  constructor(tsconfigPath: string) {
    super(`No TypeScript project at ${tsconfigPath}`);
    this.name = "ProjectNotFoundError";
    this.tsconfigPath = tsconfigPath;
  }
}

/** A diagnostic from `tsc` itself, surfaced before we attempt any translation. */
export class TypeCheckError extends Error {
  readonly diagnostics: readonly string[];

  constructor(diagnostics: readonly string[]) {
    super(`TypeScript reported ${diagnostics.length} error(s)`);
    this.name = "TypeCheckError";
    this.diagnostics = diagnostics;
  }
}
