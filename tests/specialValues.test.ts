import { beforeAll, expect, test } from "bun:test";
import { resolve } from "node:path";
import { compileProject, formatResult, type ManifestFunction } from "../src/compile.ts";
import { openDatabase, type Database } from "../src/runParity.ts";

/**
 * The `Math` functions agree with JavaScript on the values the fast-check
 * harness never draws: NaN, the infinities and the two zeros.
 *
 * `src/parity.ts` generates finite doubles and compares ±0 as equal, so a
 * rewrite that exists only for those values (`sign(NaN)`, `sqrt(-1)`,
 * `min(NaN, 1)`) is checked here, one fixed grid, strictly with `Object.is`.
 * Like the rest of the suite it holds no cases: it runs `tests/parity/mathFunctions.ts`.
 */

const FILES = ["mathFunctions", "mathConstants"].map((name) => resolve(`tests/parity/${name}.ts`));
const DOUBLES = [
  NaN,
  Infinity,
  -Infinity,
  0,
  -0,
  0.5,
  -0.5,
  1.5,
  -1.5,
  2.5,
  -2.5,
  0.49999999999999994,
  2 ** 52 + 1,
  1e308,
  -5e-324,
  // the edges of `real`, for fround
  3.4028234663852886e38,
  3.4028235677973366e38,
  2 ** -149,
  2 ** -150,
  -(2 ** -150),
  16777217,
];
const INTEGERS = [0, 1, -1, 7, -7, 255, 65536, 2147483647, -2147483648];

const result = await compileProject({
  tsconfig: "tests/parity/tsconfig.json",
  include: (file) => FILES.includes(resolve(file)),
  emit: { schema: "app" },
});

function literal(value: number, sql: string): string {
  if (sql === "integer") return `${value}`;
  if (Number.isNaN(value)) return "'NaN'::double precision";
  if (value === Infinity) return "'Infinity'::double precision";
  if (value === -Infinity) return "'-Infinity'::double precision";
  return `'${Object.is(value, -0) ? "-0" : value}'::double precision`;
}

function grids(fn: ManifestFunction): number[][] {
  let rows: number[][] = [[]];
  for (const param of fn.params) {
    const values = (param.type as { sql: string }).sql === "integer" ? INTEGERS : DOUBLES;
    rows = rows.flatMap((row) => values.map((value) => [...row, value]));
  }
  return rows;
}

function same(a: number, b: number): boolean {
  return Object.is(a, b);
}

let db: Database;
beforeAll(async () => {
  db = await openDatabase();
  await db.exec(result.sql);
});

test("compiles", () => {
  expect(formatResult(result)).toBe("");
});

test("every Math function agrees with JavaScript on NaN, infinities and signed zeros", async () => {
  const failures: string[] = [];
  for (const fn of result.manifest.functions) {
    const impl = ((await import(resolve(fn.module))) as Record<string, (...args: number[]) => number>)[fn.tsName]!;
    for (const args of grids(fn)) {
      let expected: number | "raise";
      try {
        expected = impl(...args);
      } catch {
        expected = "raise";
      }
      const call = `app.${fn.sqlName}(${args.map((v, i) => literal(v, (fn.params[i]!.type as { sql: string }).sql)).join(", ")})`;
      let actual: number | "raise";
      try {
        const row = (await db.query(`SELECT (${call})::text AS v`, [])) as { v: string };
        actual = Number(row.v);
      } catch {
        actual = "raise";
      }
      const ok = expected === "raise" || actual === "raise" ? expected === actual : same(expected, actual);
      if (!ok)
        failures.push(
          `${fn.tsName}(${args.map((v) => (Object.is(v, -0) ? "-0" : v)).join(", ")}): TypeScript ${String(expected)}, SQL ${String(actual)}`,
        );
    }
  }
  expect(failures).toEqual([]);
});
