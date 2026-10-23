import type { Node } from "typescript/unstable/ast";

/**
 * An unsupported-construct rejection, carrying a source position so the build
 * failure reads like a compiler error rather than a stack trace.
 */
export class CompileError extends Error {
  constructor(
    message: string,
    readonly fileName: string,
    readonly line: number,
    readonly column: number,
    readonly sourceLine?: string,
  ) {
    super(message);
    this.name = "CompileError";
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
  constructor(readonly tsconfigPath: string) {
    super(`No TypeScript project at ${tsconfigPath}`);
    this.name = "ProjectNotFoundError";
  }
}

/** A diagnostic from `tsc` itself, surfaced before we attempt any translation. */
export class TypeCheckError extends Error {
  constructor(readonly diagnostics: readonly string[]) {
    super(`TypeScript reported ${diagnostics.length} error(s)`);
    this.name = "TypeCheckError";
  }
}
