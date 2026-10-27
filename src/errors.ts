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
    const at = positionOf(node);
    return new CompileError(message, at.fileName, at.line, at.column, at.sourceLine, at.length);
  }

  /** Like a tsc diagnostic: position, message, the source line with the construct underlined. */
  format(root = process.cwd(), paint: Paint = PLAIN): string {
    return formatDiagnostic(this, root, paint, "red");
  }
}

/**
 * A construct the compiler accepts but can translate better.
 *
 * Never fatal: `check` and `compile` report it and still succeed. The compiler
 * only ever raises one when it has a concrete rewrite to name — advice without
 * a remedy describes a problem the author cannot act on, and advice naming the
 * wrong remedy is worse than none, which is why `tests/rejected/` can assert a
 * message does *not* appear.
 *
 * Not an `Error`: it is never thrown, only collected.
 */
export class CompileWarning {
  readonly message: string;
  readonly fileName: string;
  readonly line: number;
  readonly column: number;
  readonly sourceLine?: string;
  readonly length: number;

  constructor(message: string, fileName: string, line: number, column: number, sourceLine?: string, length = 1) {
    this.message = message;
    this.fileName = fileName;
    this.line = line;
    this.column = column;
    this.sourceLine = sourceLine;
    this.length = Math.max(1, length);
  }

  static at(node: Node, message: string): CompileWarning {
    const at = positionOf(node);
    return new CompileWarning(message, at.fileName, at.line, at.column, at.sourceLine, at.length);
  }

  format(root = process.cwd(), paint: Paint = PLAIN): string {
    return formatDiagnostic(this, root, paint, "yellow");
  }
}

interface Positioned {
  readonly message: string;
  readonly fileName: string;
  readonly line: number;
  readonly column: number;
  readonly sourceLine?: string;
  readonly length: number;
}

function positionOf(node: Node): Omit<Positioned, "message"> {
  const file = node.getSourceFile();
  const start = node.getStart(file);
  const { line, character } = file.getLineAndCharacterOfPosition(start);
  const text = file.text.split("\n")[line];
  // Underline the whole construct, up to the end of its first line.
  const length = Math.min(node.end - start, (text ?? "").length - character);
  return { fileName: file.fileName, line: line + 1, column: character + 1, sourceLine: text, length };
}

/** One shape for both, so a refusal and a piece of advice are read the same way. */
function formatDiagnostic(d: Positioned, root: string, paint: Paint, underlineColour: "red" | "yellow"): string {
  const where = d.fileName.startsWith(root) ? d.fileName.slice(root.length + 1) : d.fileName;
  const head = `${paint("cyan", where)}:${paint("yellow", String(d.line))}:${paint("yellow", String(d.column))} - ${d.message}`;
  if (d.sourceLine === undefined) return head;
  const gutter = paint("gray", `${String(d.line).padStart(5)} |`);
  const blank = paint("gray", `${" ".repeat(5)} |`);
  const underline = paint(underlineColour, "^".repeat(d.length));
  return `${head}\n\n${gutter} ${d.sourceLine}\n${blank} ${" ".repeat(d.column - 1)}${underline}\n`;
}

/**
 * The functions project could not be opened.
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
