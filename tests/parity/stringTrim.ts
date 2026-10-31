import { type Integer } from "../../src/index";

/**
 * The three trims of `String.prototype`, as `btrim`, `ltrim` and `rtrim` over the
 * set of characters JavaScript strips. The set form is what makes them the same
 * function: it depends on neither the database's locale nor its collation.
 *
 * The harness draws arbitrary text, which is nearly all printable ASCII, so these
 * cases mostly check that trimming a string PostgreSQL has nothing to trim leaves
 * it alone — `tests/trimValues.test.ts` is where the 25 whitespace code points
 * themselves are pinned, on both sides.
 */

export enum Severity {
  Low = "low",
  High = "high",
}

export type Locale = "eu" | "us";

export interface Entry {
  readonly label: string;
  readonly locale: Locale;
}

export function trimBoth(s: string): string {
  return s.trim();
}

export function trimLeading(s: string): string {
  return s.trimStart();
}

export function trimTrailing(s: string): string {
  return s.trimEnd();
}

// A field of a composite, read as any other text value is.
export function trimLabel(entry: Entry): string {
  return entry.label.trim();
}

// A domain is text structurally, so it needs no cast; trimming it is a plain
// `string`, since nothing proves the result is still one of the union's members.
export function trimLocale(entry: Entry): string {
  return entry.locale.trimEnd();
}

// An enum is cast `::text` first, as TypeScript reads a member as a string.
export function trimSeverity(level: Severity): string {
  return level.trim();
}

// Chained: the operand of the second is the first call.
export function trimTwice(s: string): string {
  return s.trimStart().trimEnd();
}

// A literal operand, and a call result as the operand.
export function trimLiteral(): string {
  return "  padded  ".trim();
}

export function trimCallResult(s: string): string {
  return trimBoth(s).trimStart();
}

// Inside a larger expression, where the result is used as text.
export function isBlank(s: string): boolean {
  return s.trim() === "";
}

export function trimmedLength(s: string): Integer {
  return s.trim() === s ? 0 : 1;
}

export function trimmedConcat(a: string, b: string): string {
  return `${a.trimEnd()}-${b.trimStart()}`;
}

// A conditional operand, parenthesised, and a trim of a local.
export function trimEither(a: string, b: string, first: boolean): string {
  const chosen = first ? a : b;
  return chosen.trim();
}
