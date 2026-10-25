import type { Node } from "typescript/unstable/ast";
import { painter, type Paint } from "./style.ts";

const PLAIN = painter(false);

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
  /** How many characters of `sourceLine` the refused construct covers, from `column`. */
  readonly length: number;

  constructor(message: string, fileName: string, line: number, column: number, sourceLine?: string, length = 1) {
    super(message);
    this.name = "CompileError";
    this.fileName = fileName;
    this.line = line;
    this.column = column;
    this.sourceLine = sourceLine;
    this.length = Math.max(1, length);
  }

  static at(node: Node, message: string): CompileError {
    const file = node.getSourceFile();
    const start = node.getStart(file);
    const { line, character } = file.getLineAndCharacterOfPosition(start);
    const text = file.text.split("\n")[line];
    // Underline the whole construct, up to the end of its first line.
    const length = Math.min(node.end - start, (text ?? "").length - character);
    return new CompileError(message, file.fileName, line + 1, character + 1, text, length);
  }

  /** Like a tsc diagnostic: position, message, the source line with the construct underlined. */
  format(root = process.cwd(), paint: Paint = PLAIN): string {
    const where = this.fileName.startsWith(root) ? this.fileName.slice(root.length + 1) : this.fileName;
    const head = `${paint("cyan", where)}:${paint("yellow", String(this.line))}:${paint("yellow", String(this.column))} - ${this.message}`;
    if (this.sourceLine === undefined) return head;
    const gutter = paint("gray", `${String(this.line).padStart(5)} |`);
    const blank = paint("gray", `${" ".repeat(5)} |`);
    const underline = paint("red", "^".repeat(this.length));
    return `${head}\n\n${gutter} ${this.sourceLine}\n${blank} ${" ".repeat(this.column - 1)}${underline}\n`;
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
