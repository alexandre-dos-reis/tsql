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
 *
 * Known residual, recorded in docs/design.md ("Math"): when both arguments of
 * `Math.min` / `Math.max` are zeros of opposite sign, PostgreSQL returns the
 * first one where JavaScript orders -0 below +0. Those functions compare ±0 as equal.
 */

const FILE = resolve("tests/parity/mathFunctions.ts");
const DOUBLES = [NaN, Infinity, -Infinity, 0, -0, 0.5, -0.5, 2.5, -2.5, 1e308, -5e-324];
const INTEGERS = [0, 1, -1, 7, -7, 2147483647];
const SIGNED_ZERO_TIES = new Set(["mathMax", "mathMinInt", "mathMinFloat", "mathMinMixed", "mathClamp", "mathWidest"]);

const result = await compileProject({
  tsconfig: "tests/parity/tsconfig.json",
  include: (file) => resolve(file) === FILE,
  emit: { schema: "app" },
});
const module = (await import(FILE)) as Record<string, (...args: number[]) => number>;

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

function same(name: string, a: number, b: number): boolean {
  return Object.is(a, b) || (SIGNED_ZERO_TIES.has(name) && a === b);
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
    const impl = module[fn.tsName]!;
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
      const ok = expected === "raise" || actual === "raise" ? expected === actual : same(fn.tsName, expected, actual);
      if (!ok)
        failures.push(
          `${fn.tsName}(${args.map((v) => (Object.is(v, -0) ? "-0" : v)).join(", ")}): TypeScript ${String(expected)}, SQL ${String(actual)}`,
        );
    }
  }
  expect(failures).toEqual([]);
});
