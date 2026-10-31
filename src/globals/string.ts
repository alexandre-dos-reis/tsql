/**
 * The methods of `String.prototype` that compile, and why the others do not.
 *
 * The same shape as `src/globals/math.ts` and `src/globals/number.ts`, and for
 * the same reason: a closed table, so a method `String.prototype` grows later
 * stays refused until someone has measured it. The difference is where the
 * method is found — `Math` and `Number` are globals, resolved by provenance,
 * while these are called on a *value* whose PostgreSQL type lowering already
 * knows is `text`, so there is no global to recognise.
 *
 * Today the table holds the three trims, which are the ones PostgreSQL has
 * under another name and with the *same* definition. `btrim`, `ltrim` and
 * `rtrim` take the set of characters to remove, so they depend on neither the
 * database's locale nor its collation — which is exactly what keeps
 * `toUpperCase` out (`upper()` follows the database's rules, not JavaScript's
 * Unicode case mapping). `docs/design.md`, "Strings", has the measurements.
 */

export interface StringMethod {
  /**
   * The PostgreSQL function it becomes, called with the characters to remove as
   * its second argument. Not a helper in the `tsql` schema: the set form of
   * these three is the same function, so there is nothing to write.
   */
  readonly sql: string;
}

export const STRING_METHODS: Readonly<Record<string, StringMethod>> = {
  trim: { sql: "btrim" },
  trimEnd: { sql: "rtrim" },
  trimStart: { sql: "ltrim" },
};

/**
 * Every code point `trim` removes: ECMAScript's `WhiteSpace` production (the
 * tab, the vertical tab, the form feed, U+FEFF, and Unicode's
 * `Space_Separator` category) together with `LineTerminator` (LF, CR, U+2028,
 * U+2029).
 *
 * Written out rather than derived, because deriving it means testing all 65 536
 * code points of the BMP at load time, on every compile. `tests/trimValues.test.ts`
 * does that derivation instead and asserts this list is what the running engine
 * strips — so a Unicode revision that changed `Space_Separator` would fail the
 * suite rather than silently emit the wrong set.
 *
 * Ascending, which is the order they are emitted in: the literal in the
 * migration is then the same text whatever the table's order here.
 */
// A table of code points reads better in rows than one per line.
// prettier-ignore
export const JS_WHITESPACE: readonly number[] = [
  0x0009, 0x000a, 0x000b, 0x000c, 0x000d, 0x0020, 0x00a0, 0x1680,
  0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007,
  0x2008, 0x2009, 0x200a, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000,
  0xfeff,
];

/** `Object.hasOwn`, so `"x".constructor` and `"x".toString` are not mistaken for members. */
export function stringMethod(member: string): StringMethod | undefined {
  return Object.hasOwn(STRING_METHODS, member) ? STRING_METHODS[member] : undefined;
}

/** Named like `ARRAY_SUBSET`, and used in the same two places: the member that is not in the table, and the operand that is not a string. */
export const STRING_SUBSET = "On a string, the compiled subset is `.trim()`, `.trimStart()` and `.trimEnd()`.";

/**
 * Specific reasons, for the members worth one. Each says why the SQL that looks
 * like it would not be the same function, rather than merely that it is missing.
 */
const REASONS: Readonly<Record<string, string>> = {
  toUpperCase:
    "`upper()` follows the database's locale and collation, where TypeScript follows Unicode's case mapping — and neither maps `ß` to `SS` the way the other does.",
  toLowerCase: "`lower()` follows the database's locale and collation, not Unicode's case mapping.",
  length:
    "TypeScript counts UTF-16 code units and PostgreSQL's `length()` counts characters, so they disagree on every character outside the BMP (`'😀'.length` is 2).",
  charCodeAt: "it reads one UTF-16 code unit, which PostgreSQL's `text` is not made of.",
  codePointAt: "`ascii()` reads the first character only, and TypeScript's index counts UTF-16 code units.",
  indexOf:
    "`strpos()` counts characters from 1 and answers 0 when absent, where `indexOf` counts UTF-16 code units from 0 and answers -1.",
  slice: "its indices count UTF-16 code units, and it accepts negative ones, where `substring()` does neither.",
  substring: "its indices count UTF-16 code units, where `substring()` counts characters.",
  split: "it returns an array of text whose length is not known at build time.",
  replace:
    "`replace()` changes every occurrence where TypeScript's changes the first, and a regular expression is not part of the subset.",
  normalize: "PostgreSQL's `normalize()` exists, but which forms agree with TypeScript's has not been measured.",
  padStart: "`lpad()` truncates a string longer than the target width where `padStart` returns it unchanged.",
  padEnd: "`rpad()` truncates a string longer than the target width where `padEnd` returns it unchanged.",
  trimLeft: "write `trimStart`, which compiles — `trimLeft` is its deprecated alias.",
  trimRight: "write `trimEnd`, which compiles — `trimRight` is its deprecated alias.",
};

const SUPPORTED = Object.keys(STRING_METHODS)
  .sort()
  .map((name) => `.${name}()`)
  .join(", ");

/**
 * The error text for a member of a string that is not in the table. `property`
 * spells it `.length` rather than `.length()`, so a member read as a value is
 * not quoted back as a call.
 */
export function unsupportedStringMessage(member: string, property = false): string {
  const reason = Object.hasOwn(REASONS, member)
    ? REASONS[member]!
    : "it has no PL/pgSQL equivalent that was measured to return the same value for every input.";
  return `\`.${member}${property ? "" : "()"}\` on a string is not supported: ${reason} Supported: ${SUPPORTED}.`;
}
