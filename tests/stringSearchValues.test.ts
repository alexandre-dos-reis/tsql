import { beforeAll, expect, test } from "bun:test";
import { resolve } from "node:path";

import { compileProject, formatResult } from "../src/compile";
import { openDatabase, type Database } from "../src/runParity";

/**
 * `includes`, `startsWith` and `endsWith` agree with JavaScript on the pairs of
 * strings the fast-check harness will not draw.
 *
 * `src/parity.ts` generates each `text` parameter independently, so two of them
 * are almost never one inside the other: the parity case passes on pairs where
 * both sides merely answer `false`, and would keep passing if the SQL were wrong
 * about every pair that matches. This is the grid that pins them — the empty
 * needle (which all three answer `true` for), a needle equal to the subject, a
 * needle longer than it, overlapping and repeated matches, a match that is only
 * at the wrong end, characters outside the BMP, and combining marks, where
 * counting UTF-16 code units rather than characters would show.
 *
 * NUL and lone surrogates are left out: they have no PostgreSQL `text` value,
 * which `src/parity.ts` filters for the same reason.
 *
 * Comparisons are made **inside PostgreSQL**, the expected value sent as a
 * parameter, so a driver's decoding cannot colour the answer.
 *
 * Like the rest of the suite it holds no cases of its own: it runs
 * `stringMethods.ts` of `tests/parity/`, through the functions that file exports.
 */

const FILE = resolve("tests/parity/stringMethods.ts");

/** `[subject, needle]`, chosen so each is a `true` for at least one of the three. */
const PAIRS: readonly (readonly [string, string])[] = [
  // The empty needle: `true` for all three.
  ["", ""],
  ["abc", ""],
  // Needle equal to the subject, and longer than it.
  ["abc", "abc"],
  ["abc", "abcd"],
  ["", "a"],
  // Each end, and the middle.
  ["abc", "a"],
  ["abc", "c"],
  ["abc", "b"],
  ["abc", "ab"],
  ["abc", "bc"],
  ["abc", "ac"],
  // Overlapping and repeated, where a naive scan slips.
  ["aaa", "aa"],
  ["abab", "ab"],
  ["abab", "ba"],
  ["aXbXc", "X"],
  // A match at the wrong end only.
  ["abcabc", "abc"],
  ["xabc", "abc"],
  ["abcx", "abc"],
  // Outside the BMP: one character in PostgreSQL, two code units in TypeScript.
  ["😀", "😀"],
  ["a😀b", "😀"],
  ["a😀b", "a"],
  ["a😀", "😀"],
  ["😀a", "😀"],
  ["👨‍👩‍👧", "👩"],
  ["👨‍👩‍👧", "👨‍👩‍👧"],
  // Combining marks: the same text, composed and decomposed, is not the same string.
  ["é", "é"],
  ["é", "e"],
  ["é", "́"],
  ["é", "e"],
  // Whitespace, which the searches must not touch.
  [" abc ", "abc"],
  [" abc ", " "],
  ["\tabc", "\t"],
  ["abc ", " "],
  // Case, which is a difference and not a collation question.
  ["ABC", "abc"],
  ["abc", "ABC"],
  ["ß", "ss"],
  ["ß", "ß"],
  // Characters with meaning in LIKE, which `starts_with` and `strpos` have none of.
  ["a%c", "%"],
  ["a%c", "%c"],
  ["a_c", "_"],
  ["100%", "%"],
  ["a\\c", "\\"],
  ["abc", "%"],
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

test.each([
  ["has_part", (s: string, t: string) => s.includes(t)],
  ["starts_with_part", (s: string, t: string) => s.startsWith(t)],
  ["ends_with_part", (s: string, t: string) => s.endsWith(t)],
] as const)("app.%s agrees with TypeScript on every pair", async (fn, expected) => {
  const wrong: string[] = [];
  for (const [subject, needle] of PAIRS) {
    const row = await db.query(`SELECT app.${fn}($1::text, $2::text) IS NOT DISTINCT FROM $3::boolean AS agrees`, [
      subject,
      needle,
      expected(subject, needle),
    ]);
    if (row.agrees !== true) {
      wrong.push(`${JSON.stringify(subject)} / ${JSON.stringify(needle)} -> ${expected(subject, needle)}`);
    }
  }
  expect(wrong).toEqual([]);
});

/**
 * The grid must exercise both answers for each function, or a wrong
 * implementation that always answered `false` would pass it.
 */
test("the grid holds both answers for each of the three", () => {
  const counts = [
    PAIRS.filter(([s, t]) => s.includes(t)).length,
    PAIRS.filter(([s, t]) => s.startsWith(t)).length,
    PAIRS.filter(([s, t]) => s.endsWith(t)).length,
  ];
  for (const trues of counts) {
    expect(trues).toBeGreaterThan(4);
    expect(PAIRS.length - trues).toBeGreaterThan(4);
  }
});
