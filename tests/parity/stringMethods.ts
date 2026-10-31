import { type Integer } from "../../src/index";

/**
 * The methods of `String.prototype` that compile: the three trims, as `btrim`,
 * `ltrim` and `rtrim` over the set of characters JavaScript strips, and the three
 * searches, as `starts_with` and `strpos`. Neither group consults the database's
 * locale or collation — the trims are handed the characters to remove, and the
 * searches compare code points — which is what makes them the same functions.
 *
 * The harness draws arbitrary text, which is nearly all printable ASCII and almost
 * never one string inside another, so these cases mostly check the shapes.
 * `tests/trimValues.test.ts` and `tests/stringSearchValues.test.ts` are where the
 * values are pinned on both sides.
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

export function hasPart(s: string, part: string): boolean {
  return s.includes(part);
}

export function startsWithPart(s: string, part: string): boolean {
  return s.startsWith(part);
}

// No `ends_with` in PostgreSQL: a prefix test on both strings reversed, which
// reads each argument once.
export function endsWithPart(s: string, part: string): boolean {
  return s.endsWith(part);
}

// A literal needle, and the empty needle every search answers `true` for.
export function hasAt(email: string): boolean {
  return email.includes("@");
}

export function hasEmpty(s: string): boolean {
  return s.includes("");
}

// A composite field as the needle, and an enum as the subject.
export function labelHasLocale(entry: Entry): boolean {
  return entry.label.includes(entry.locale);
}

export function severityStartsWith(level: Severity, part: string): boolean {
  return level.startsWith(part);
}

// Composed with the trims, and with a call result as the needle — which must be
// evaluated once, not once per read.
export function trimmedEndsWith(s: string, part: string): boolean {
  return s.trim().endsWith(part);
}

export function endsWithTrimmed(s: string, part: string): boolean {
  return s.endsWith(trimBoth(part));
}

// In a condition, which is where a predicate usually goes.
export function kindOf(s: string): Integer {
  if (s.startsWith("a")) return 1;
  if (s.endsWith("z")) return 2;
  return s.includes("-") ? 3 : 0;
}
