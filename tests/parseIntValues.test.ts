import { beforeAll, expect, test } from "bun:test";
import { resolve } from "node:path";
import { compileProject, formatResult } from "../src/compile.ts";
import { openDatabase, type Database } from "../src/runParity.ts";

/**
 * `Number.parseInt` agrees with JavaScript on the strings the fast-check
 * harness will not draw.
 *
 * `src/parity.ts` generates arbitrary text for a `text` parameter, and almost
 * none of it parses — so the parity case passes on inputs where both sides
 * merely raise, and would keep passing if the SQL were wrong about every string
 * that *does* parse. This is the fixed grid that actually pins the behaviour:
 * whitespace, signs, trailing garbage, the `0x` prefix with and without digits,
 * the rounding ties past 2^53, the overflow boundary, and the strings whose
 * value leaves `integer` so both sides must raise.
 *
 * Like the rest of the suite it holds no cases of its own: it runs
 * `parseInt.ts` of `tests/parity/`, through the functions that file exports.
 */

const FILE = resolve("tests/parity/parseInt.ts");

/** Read by both exported single-argument functions: `readNumber` and `readDecimal`. */
const STRINGS = [
  // plain, and the prefix rule
  "42", "0", "7", "-7", "+5", "  42  ", "\t\n42", "\u{feff}42", "0".repeat(20) + "42",
  // read a prefix, ignore the rest
  "42abc", "12.9", "1e3", "0.5", "12 34",
  // nothing to read: NaN in TypeScript, so `int` throws and the cast raises
  "", "   ", "abc", "Infinity", "-Infinity", "+-3", "- 3", "null", "undefined",
  // signed zero, which `numeric` does not have
  "-0", "-000", "-0.0", "  -0  ",
  // the 0x prefix: hexadecimal with no radix, stopped at the `x` with radix 10
  "0x1F", "0X1f", " 0x10", "0xDEADBEEF", "-0x10", "+0x10", "0x0",
  // a prefix with nothing after it is NaN, not the 0 that base ten would read
  "0x", "0xzz", "0b101", "0o17",
  // the edges of `integer`, and past them, where both sides must raise
  "2147483647", "-2147483648", "2147483648", "-2147483649",
  // past a double's exact range and past its range entirely
  "9007199254740993", "99999999999999999999", "1" + "0".repeat(400),
  "0x" + "f".repeat(14), "0x" + "f".repeat(256),
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

test("Number.parseInt agrees with JavaScript, raising where it raises", async () => {
  const failures: string[] = [];
  for (const fn of result.manifest.functions) {
    if (fn.params.length !== 1) continue; // readTwice takes two; the one-argument pair is what this grid is for
    const impl = ((await import(resolve(fn.module))) as Record<string, (text: string) => number>)[fn.tsName]!;
    for (const text of STRINGS) {
      // `int` throws on NaN and outside 32 bits; the cast raises on the same.
      let expected: number | "raise";
      try {
        expected = impl(text);
      } catch {
        expected = "raise";
      }
      let actual: number | "raise";
      try {
        const row = (await db.query(`SELECT (app.${fn.sqlName}($1))::text AS v`, [text])) as { v: string };
        actual = Number(row.v);
      } catch {
        actual = "raise";
      }
      // `===` rather than `Object.is`, which also makes "raise" compare by
      // identity: these functions return `integer`, which has no negative zero,
      // while TypeScript's `int(-0)` keeps the one `parseInt("-0")` produced.
      // That difference is unobservable in an `integer` — `src/parity.ts`
      // compares ±0 as equal for the same reason — so separating them here would
      // report a divergence nobody could act on.
      if (expected !== actual) failures.push(`${fn.tsName}(${JSON.stringify(text)}): TypeScript ${String(expected)}, SQL ${String(actual)}`);
    }
  }
  expect(failures).toEqual([]);
}, 60_000); // one round trip per function and string: slow on a real server
