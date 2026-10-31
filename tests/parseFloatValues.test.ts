import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { resolve } from "node:path";

import { compileProject, formatResult } from "../src/compile";
import { openDatabase, type Database } from "../src/runParity";

/**
 * `Number.parseFloat` agrees with JavaScript on the strings the fast-check
 * harness will not draw.
 *
 * `src/parity.ts` generates arbitrary text for a `text` parameter, and almost
 * none of it is a number — so the parity case passes on inputs where both sides
 * answer `NaN`, and would keep passing if the SQL were wrong about every string
 * that *does* parse. This is the fixed grid that actually pins the behaviour:
 * every whitespace character and the look-alikes that are not, the forms a
 * decimal literal takes, an exponent with and without digits, trailing garbage,
 * `Infinity` and its near misses, signed zeros, the rounding ties, and the two
 * ends of the double range, where PostgreSQL's own `float8` input raises and
 * JavaScript answers `±Infinity` or `±0` — the place a plain cast is wrong.
 *
 * The edges are computed, not typed: the point where a double rounds to
 * infinity (`2^1024 - 2^970`) and the one where it rounds to zero (`2^-1075`)
 * are written out in full from `BigInt`, and so are the exact midpoints between
 * two neighbouring doubles, which a correct decimal-to-double conversion must
 * send to the even one. One digit either side of each is in the grid as well.
 *
 * The second test is the specification side of the same question: every
 * example written down at
 * https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/parseFloat
 * is checked against the documented answer rather than against whatever the
 * engine running the test does — so the SQL is pinned to the language, not to
 * one engine.
 *
 * The third is the limit the helper has, and says so by raising: past what a
 * `numeric` can hold (a value of about 10^130749 or more, or under 10^-16383)
 * there is no answer, and an error is what it gives, never a wrong value.
 *
 * Like the rest of the suite it holds no cases of its own: it runs
 * `parseFloat.ts` of `tests/parity/`, through the function that file exports.
 * That is `readFloat` alone: `readHalf` divides, and PostgreSQL raises where a
 * double division underflows, which is arithmetic and not what is tested here.
 *
 * It runs on PGlite and, when `TSQL_TEST_DB_URL` names one, on a real
 * PostgreSQL. The two are not interchangeable here: PGlite is WebAssembly on
 * musl, whose decimal-to-double conversion rounds a string of a thousand digits
 * near the middle of two denormals the wrong way, where glibc's does not — so
 * no such string is in the grid. Every string that is, passes on both.
 */

const FILE = resolve("tests/parity/parseFloat.ts");

/** The exact decimal expansion of `m * 2^e`, `m` a positive integer. */
function exact(m: bigint, e: number): string {
  if (e >= 0) return (m << BigInt(e)).toString();
  const shift = -e;
  const digits = (m * 5n ** BigInt(shift)).toString().padStart(shift + 1, "0");
  return `${digits.slice(0, digits.length - shift)}.${digits.slice(digits.length - shift)}`;
}

/** The exact midpoint between a positive normal double and the next one up. */
function midpoint(d: number): string {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, d);
  const bits = view.getBigUint64(0);
  const mantissa = (bits & ((1n << 52n) - 1n)) | (1n << 52n);
  const exponent = Number((bits >> 52n) & 0x7ffn) - 1075;
  return exact(2n * mantissa + 1n, exponent - 1);
}

/** The same decimal with its last digit moved by one, up or down: just past a boundary, on either side. */
function around(decimal: string): [string, string] {
  const last = Number(decimal.at(-1));
  const next = (digit: number) => decimal.slice(0, -1) + String(digit);
  return [next(last === 0 ? 1 : last - 1), next(last === 9 ? 8 : last + 1)];
}

/** Rounds to infinity from here, the midpoint between the largest double and `2^1024`, the tie going to the latter. */
const INFINITY_FROM = exact(2n ** 1024n - 2n ** 970n, 0);
/** Rounds to zero up to here, half the smallest double, the tie going to zero. */
const ZERO_UP_TO = exact(1n, -1075);

const WHITESPACE = [
  "\t",
  "\n",
  "\v",
  "\f",
  "\r",
  " ",
  " ",
  " ",
  ...Array.from({ length: 11 }, (_, i) => String.fromCharCode(0x2000 + i)),
  " ",
  " ",
  " ",
  " ",
  "　",
  "﻿",
];
/** Not whitespace to JavaScript, though some of them were once, or are in another standard. */
const NOT_WHITESPACE = ["᠎", "\u0085", "​", "⁠", "­"];

const SHAPES = [
  // plain, and the forms a decimal literal takes
  "3.14",
  "0",
  "7",
  "-7",
  "+5",
  "5.",
  ".5",
  "-.5",
  "+.5e-2",
  "5.e3",
  "00012.50",
  "0.0314E+2",
  "314e-2",
  ".314e1",
  "1E5",
  "1e05",
  "1e+05",
  "1e0005",
  // an exponent is read only when it has digits
  "1e",
  "1e+",
  "1e-",
  "1E",
  "1e5e5",
  "1e5.5",
  "1.5e",
  // read a prefix, ignore the rest
  "3.14abc",
  "3.14some non-digit characters",
  "12 34",
  "1.2.3",
  "1_000",
  "1,5",
  "5px",
  "0x10",
  "0b101",
  "0o17",
  "1e3abc",
  "4.567abcdefgh",
  "900719925474099267n",
  "12٣",
  // nothing to read: NaN
  "",
  "   ",
  "abc",
  "FF2",
  "NaN",
  "-NaN",
  "null",
  "undefined",
  ".",
  "-",
  "+",
  "e5",
  ".e5",
  "-.e5",
  "+-3",
  "-+3",
  "--5",
  "- 3",
  "١٢",
  // Infinity: case-sensitive, and the exponent is not part of it
  "Infinity",
  "-Infinity",
  "+Infinity",
  "Infinityx",
  "Infinity5",
  "Infinity e5",
  "Infinitye5",
  "-Infinity abc",
  "infinity",
  "INFINITY",
  "Inf",
  "Infinit",
  "- Infinity",
  "1Infinity",
  // signed zero
  "-0",
  "-0.0",
  "-.0",
  "-0.e0",
  "-0e5",
  "+0",
  "0e5",
  "-0e100",
  "-0e-100",
  "-0.000e-500",
  // rounding
  "0.1",
  "0.3",
  "0.30000000000000004",
  "0.1000000000000000055511151231257827",
  "9007199254740992",
  "9007199254740993",
  "9007199254740992.5",
  "9007199254740995",
  "123456789012345678901234567890e-10",
  "123456789012345678901234567890",
  "2.2250738585072011e-308",
  "2.2250738585072014e-308",
  "4.9e-324",
  "5e-324",
  "1e-323",
  "1.7976931348623157e308",
  "1.7976931348623158e308",
  // past the double range, where `float8` input raises
  "1e308",
  "1e309",
  "1e310",
  "1e400",
  "1e999",
  "-1e999",
  "1.7976931348623159e308",
  "1.7976931348623159e+308",
  "-1.7976931348623159e+308",
  "1.8e308",
  "1e-324",
  "1e-325",
  "1e-400",
  "-1e-400",
  "-1e-999",
  "2.4703282292062327e-324",
  "2.4703282292062328e-324",
  "1e0308",
  "1e+0309",
  "1e000308",
  "1e-000324",
  "1e-000325",
  "1e100000",
  "-1e100000",
  "1e130748",
  "1e-10000",
  "1e-16383",
  // many digits, which is the other way out of range
  "1" + "0".repeat(307),
  "1" + "0".repeat(308),
  "1" + "0".repeat(309),
  "1" + "0".repeat(400),
  "-" + "1" + "0".repeat(400),
  "9".repeat(309),
  "9".repeat(310),
  "5".repeat(250),
  "0." + "0".repeat(322) + "1",
  "0." + "0".repeat(323) + "1",
  "0." + "0".repeat(324) + "1",
  "0." + "0".repeat(400) + "1",
  "-0." + "0".repeat(400) + "1",
  "-0." + "0".repeat(400),
  "0." + "1".repeat(500),
  // a long mantissa and an exponent that bring it back into range
  "1" + "0".repeat(300) + "e-300",
  "0." + "0".repeat(300) + "1e300",
  "5".repeat(250) + ".5e-300",
  // a three-digit exponent is read by the input, where a two-digit one is, too
  "1e99",
  "1e100",
  "1.5e-99",
  "1.5e-100",
  // the exact edges, and one digit either side of each
  INFINITY_FROM,
  ...around(INFINITY_FROM),
  ZERO_UP_TO,
  ...around(ZERO_UP_TO),
  // the exact ties between two doubles, and one digit either side: the even one must win
  ...[1, 0.1, 2 ** 52, 2 ** 53, 123456.789, Number.MAX_VALUE / 2].flatMap((d) => {
    const tie = midpoint(d);
    return [tie, ...around(tie)];
  }),
];

const STRINGS = [
  ...SHAPES,
  // the same, behind each kind of whitespace and with a sign in front
  ...WHITESPACE.map((w) => `${w}3.14`),
  ...WHITESPACE.map((w) => `${w}${w}-1e309${w}`),
  ...WHITESPACE.map((w) => `${w}-0`),
  ...NOT_WHITESPACE.map((w) => `${w}3.14`),
  ...SHAPES.filter((s) => s.length < 200).flatMap((s) => [`  ${s}`, `\t\n${s}`, `${s} trailing`]),
];

const result = await compileProject({
  tsconfig: "tests/parity/tsconfig.json",
  include: (file) => resolve(file) === FILE,
  emit: { schema: "app" },
});

test("compiles", () => {
  expect(formatResult(result)).toBe("");
});

const readFloat = result.manifest.functions.find((fn) => fn.tsName === "readFloat")!;

/** `NaN`, `Infinity` and `-0` as the `double precision` output spells them are what `Number` reads, too. */
const fromSql = (text: string): number => Number(text);

const show = (n: number) => (Object.is(n, -0) ? "-0" : String(n));
const label = (text: string) =>
  JSON.stringify(text.length > 60 ? `${text.slice(0, 24)}… (${text.length} characters)` : text);

const BACKENDS: readonly { readonly name: string; readonly url: string | undefined }[] = [
  { name: "PGlite", url: undefined },
  { name: "PostgreSQL", url: process.env.TSQL_TEST_DB_URL },
];

for (const backend of BACKENDS) {
  describe.skipIf(backend.name !== "PGlite" && backend.url === undefined)(
    `Number.parseFloat on ${backend.name}`,
    () => {
      let db: Database;
      beforeAll(async () => {
        db = await openDatabase(backend.url);
        await db.exec(result.sql);
      });
      afterAll(async () => {
        await db?.close();
      });

      const call = async (text: string): Promise<number | "raise"> => {
        try {
          const row = (await db.query(`SELECT (app.${readFloat.sqlName}($1))::text AS v`, [text])) as { v: string };
          return fromSql(row.v);
        } catch {
          return "raise";
        }
      };

      test("agrees with JavaScript, on NaN, both infinities and both zeros too", async () => {
        const impl = ((await import(resolve(readFloat.module))) as Record<string, (text: string) => number>)[
          readFloat.tsName
        ]!;
        const failures: string[] = [];
        for (const text of STRINGS) {
          const expected = impl(text);
          const actual = await call(text);
          // `Object.is`: `NaN` equals itself, and `-0` is not `0`.
          if (actual === "raise" || !Object.is(expected, actual)) {
            failures.push(
              `${label(text)}: JavaScript ${show(expected)}, SQL ${actual === "raise" ? "raised" : show(actual)}`,
            );
          }
        }
        expect(failures).toEqual([]);
      }, 120_000); // one round trip per string: slow on a real server

      /**
       * What the page documents, written as it documents it. The examples that pass
       * an object or a number rather than a string cannot be written in SQL, which
       * has one `text` to give; the string forms are all here.
       */
      const MDN: Array<[string, number]> = [
        ["3.14", 3.14],
        ["  3.14  ", 3.14],
        ["314e-2", 3.14],
        ["0.0314E+2", 3.14],
        ["3.14some non-digit characters", 3.14],
        ["4.567abcdefgh", 4.567],
        ["abcdefgh", NaN],
        ["FF2", NaN],
        ["NaN", NaN],
        ["1.7976931348623159e+308", Infinity],
        ["-1.7976931348623159e+308", -Infinity],
        ["Infinity", Infinity],
        ["-Infinity", -Infinity],
        ["900719925474099267n", 900719925474099300], // the `n` of a BigInt literal stops the read
      ];

      test("agrees with the examples documented on MDN", async () => {
        const failures: string[] = [];
        for (const [input, documented] of MDN) {
          const actual = await call(input);
          if (actual === "raise" || !Object.is(actual, documented)) {
            failures.push(
              `parseFloat(${label(input)}): MDN ${show(documented)}, SQL ${actual === "raise" ? "raised" : show(actual)}`,
            );
          }
        }
        expect(failures).toEqual([]);
      }, 60_000);

      // The helper reads the value through `numeric`, which holds a value from 10^-16383 up to
      // 10^131072, and the comparison with the double range multiplies it by 2^1075 first, which
      // leaves 10^130749. JavaScript gives `0` and `Infinity` past either end; the helper raises,
      // because an answer it could not stand behind is worse than none. `docs/design.md` says so.
      // Should a later change close this, the test fails to say the doc and this list are stale.
      test("raises, rather than answering wrongly, where a numeric cannot hold the value", async () => {
        const BEYOND = [
          "1e130749",
          "-1e130749",
          "1e999999999",
          "1e-16384",
          "1e-999999999",
          "1" + "0".repeat(130749),
          "0." + "0".repeat(16383) + "1",
        ];
        const answers = await Promise.all(BEYOND.map(call));
        expect(answers).toEqual(BEYOND.map(() => "raise"));
      }, 60_000);
    },
  );
}
