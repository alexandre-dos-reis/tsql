import { beforeAll, expect, test } from "bun:test";
import { resolve } from "node:path";

import { compileProject, formatResult } from "../src/compile";
import { JS_WHITESPACE } from "../src/globals/string";
import { openDatabase, type Database } from "../src/runParity";

/**
 * The three trims agree with JavaScript on the strings the fast-check harness
 * will not draw.
 *
 * `src/parity.ts` generates arbitrary text for a `text` parameter, which is
 * nearly all printable ASCII — so the parity case passes on inputs with no
 * whitespace to remove at either end, and would keep passing if the character
 * set were wrong about every character but the space. This is the fixed grid
 * that pins the behaviour: each of the 25 code points on its own, at both ends,
 * in runs, around characters that must survive, and the ones a naive
 * implementation gets wrong (U+00A0, U+3000, U+FEFF — none of which the
 * one-argument `btrim(s)` removes).
 *
 * The first test is the set itself: `JS_WHITESPACE` is written out rather than
 * derived, so this derives it from the running engine over the whole BMP and
 * asserts they are the same list. A Unicode revision that changed
 * `Space_Separator`, or a typo in the table, fails here rather than emitting SQL
 * that trims the wrong characters.
 *
 * Comparisons are made **inside PostgreSQL** (`btrim(…) IS NOT DISTINCT FROM $3`,
 * the expected value sent as a parameter) rather than by reading the result
 * back: a driver drops a leading U+FEFF when it decodes text, so comparing in
 * JavaScript reports a divergence where the server holds the right value.
 *
 * Like the rest of the suite it holds no cases of its own: it runs
 * `stringMethods.ts` of `tests/parity/`, through the functions that file exports.
 */

const FILE = resolve("tests/parity/stringMethods.ts");

const WHITESPACE = JS_WHITESPACE.map((point) => String.fromCodePoint(point));

/** Strings whose ends are the interesting part, built from the whitespace and from characters that must survive. */
const STRINGS = [
  "",
  "plain",
  " ",
  "   ",
  ...WHITESPACE,
  ...WHITESPACE.map((ws) => `${ws}x`),
  ...WHITESPACE.map((ws) => `x${ws}`),
  ...WHITESPACE.map((ws) => `${ws}x${ws}`),
  ...WHITESPACE.map((ws) => `${ws}${ws}${ws}x`),
  // Inner whitespace is kept, at both ends and between.
  ...WHITESPACE.map((ws) => ` a${ws}b `),
  // Every whitespace character at once, around something that stays.
  `${WHITESPACE.join("")}kept${WHITESPACE.join("")}`,
  WHITESPACE.join(""),
  // Multibyte characters next to the trim, which must not be cut into.
  " é ",
  "\u00a0日本\u00a0",
  " 😀 ",
  "\u3000😀\u3000",
  // What a space-only `btrim(s)` would be wrong about.
  "\tx\t",
  "\nx\n",
  "\r\nx\r\n",
  "\u000bx\u000b",
  "\u000cx\u000c",
  "\u00a0x\u00a0",
  "\u3000x\u3000",
  "\ufeffx\ufeff",
  // Near misses: characters that look like whitespace and are not, so they must
  // survive at both ends — the Mongolian vowel separator (whitespace in an older
  // Unicode), the zero-width space, the word joiner, and U+FFFE.
  "\u180ex\u180e",
  "\u200bx\u200b",
  "\u2060x\u2060",
  "\ufffex\ufffe",
  // The boundaries of the U+2000..U+200A run and of U+2028/U+2029.
  "\u1fffx\u1fff",
  "\u2027x\u2027",
  "\u202ax\u202a",
];

const result = await compileProject({
  tsconfig: "tests/parity/tsconfig.json",
  include: (file) => resolve(file) === FILE,
  emit: { schema: "app" },
});

let db: Database;
beforeAll(async () => {
  db = await openDatabase();
  await db.exec(result.sql);
});

test("compiles", () => {
  expect(formatResult(result)).toBe("");
});

test("JS_WHITESPACE is exactly what the engine's `trim` removes", () => {
  const derived: number[] = [];
  for (let point = 0; point <= 0xffff; point++) {
    // A lone surrogate is not whitespace and `trim` leaves it, so testing the
    // whole BMP one code unit at a time is enough: a character that trims away
    // is one of the single code points the set must hold.
    if (String.fromCharCode(point).trim() === "") derived.push(point);
  }
  expect(derived).toEqual([...JS_WHITESPACE]);
});

test.each([
  ["trim_both", (s: string) => s.trim()],
  ["trim_leading", (s: string) => s.trimStart()],
  ["trim_trailing", (s: string) => s.trimEnd()],
] as const)("app.%s agrees with TypeScript on every whitespace character", async (fn, expected) => {
  const wrong: string[] = [];
  for (const input of STRINGS) {
    const row = await db.query(`SELECT app.${fn}($1::text) IS NOT DISTINCT FROM $2::text AS agrees`, [
      input,
      expected(input),
    ]);
    if (row.agrees !== true) wrong.push(`${JSON.stringify(input)} -> ${JSON.stringify(expected(input))}`);
  }
  expect(wrong).toEqual([]);
});
