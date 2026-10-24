import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { compileProject, formatResult, type ManifestFunction } from "../src/compile.ts";
import { checkParity, type RowQuery } from "../src/parity.ts";
import { openDatabase, type Database } from "../src/runParity.ts";

/**
 * Every case in tests/parity/ is accepted by the compiler and agrees with its
 * TypeScript.
 *
 * This file holds no cases. Each case is a file, `name.ts`, holding the rule and,
 * in `export const sqlExpected`, the SQL it must compile to. For each case:
 *
 * 1. compiled alone, its SQL contains each block of `sqlExpected` (blocks are
 *    separated by a blank line), in order, each block as consecutive lines —
 *    indentation aside. This pins the *shape* of the SQL, which parity cannot
 *    see: a quoted identifier, the form of a CASE, the types in a signature.
 *    The type guard's boilerplate and the provenance comments are left out;
 * 2. every function in it agrees with its TypeScript on 200 random inputs, on
 *    PGlite and, when TSQL_TEST_DB_URL names one, on a real PostgreSQL — through
 *    the same `openDatabase` that `tsql parity` uses.
 *
 * `sqlExpected` is an exported constant, not a function, so the compiler ignores it.
 *
 * That the harness can fail at all is proven in tests/divergent.test.ts.
 */

const DIR = "tests/parity";
const TSCONFIG = `${DIR}/tsconfig.json`;
const SCHEMA = "app";

const cases = readdirSync(DIR)
  .filter((file) => file.endsWith(".ts"))
  .sort()
  .map((file) => file.slice(0, -".ts".length));

// All cases together, as the database receives them. They share one SQL
// namespace, so function and type names must stay unique across the folder.
const project = await compileProject({ tsconfig: TSCONFIG, emit: { schema: SCHEMA } });

test("all cases compile together, as one project", () => {
  expect(formatResult(project)).toBe("");
});

/** Lines without their indentation, so `sqlExpected` can be laid out for reading. */
function lines(text: string): string[] {
  return text.split("\n").map((line) => line.trim());
}

/** Blocks of `sqlExpected`: runs of non-blank lines, separated by blank lines. */
function blocks(text: string): string[][] {
  return text
    .split(/\n\s*\n/)
    .map((block) => lines(block).filter((line) => line !== ""))
    .filter((block) => block.length > 0);
}

describe("each case compiles to its sqlExpected", () => {
  for (const name of cases) {
    test(name, async () => {
      const path = resolve(DIR, `${name}.ts`);
      const { sqlExpected } = (await import(path)) as { sqlExpected?: unknown };
      expect(typeof sqlExpected).toBe("string");

      const result = await compileProject({
        tsconfig: TSCONFIG,
        include: (fileName) => resolve(fileName) === path,
        emit: { schema: SCHEMA },
      });
      expect(formatResult(result)).toBe("");

      // Each block as consecutive lines, the blocks in order.
      const emitted = lines(result.sql);
      let from = 0;
      for (const block of blocks(sqlExpected as string)) {
        let at = -1;
        for (let i = from; i + block.length <= emitted.length && at === -1; i++) {
          if (block.every((line, k) => emitted[i + k] === line)) at = i;
        }
        if (at === -1) {
          throw new Error(`${DIR}/${name}.ts: this block of sqlExpected was not emitted (in order):\n\n${block.join("\n")}\n\nEmitted:\n\n${result.sql}`);
        }
        from = at + block.length;
      }
    });
  }
});

const BACKENDS: readonly { readonly name: string; readonly url: string | undefined }[] = [
  { name: "PGlite", url: undefined },
  { name: "PostgreSQL", url: process.env.TSQL_TEST_DB_URL },
];

async function implementation(fn: ManifestFunction): Promise<(...args: never[]) => unknown> {
  const module = (await import(resolve(fn.module))) as Record<string, (...args: never[]) => unknown>;
  const impl = module[fn.tsName];
  expect(typeof impl).toBe("function");
  return impl!;
}

for (const backend of BACKENDS) {
  const runnable = project.ok && (backend.name === "PGlite" || backend.url !== undefined);

  describe.skipIf(!runnable)(`each function agrees with its TypeScript on ${backend.name}`, () => {
    let db: Database;
    const query: RowQuery = (sql, params) => db.query(sql, params);

    beforeAll(async () => {
      db = await openDatabase(backend.url);
      await db.exec(project.sql);
    });

    afterAll(async () => {
      await db?.close();
    });

    for (const fn of project.manifest.functions) {
      test(`${fn.tsName}() === ${SCHEMA}.${fn.sqlName}()`, async () => {
        await checkParity(fn, await implementation(fn), query, SCHEMA);
      });
    }

    // CREATE OR REPLACE for functions, a guarded CREATE for types: applying the
    // same migration again must succeed.
    test("the migration can be applied again", async () => {
      await db.exec(project.sql);
    });
  });
}

// The type guard must refuse a database whose type no longer matches the rules,
// rather than leave functions reading the wrong columns. Needs an empty
// database with the stale type in it, so a fresh PGlite.
test.skipIf(!project.ok)("the migration refuses a composite type that has drifted", async () => {
  const fresh = await PGlite.create();
  try {
    await fresh.exec("CREATE SCHEMA app; CREATE TYPE app.subscription AS (plan text, stale integer);");
    const failure = await fresh.exec(project.sql).then(
      () => undefined,
      (error: Error) => error,
    );
    expect(failure?.message).toContain("app.subscription exists as");
    expect(failure?.message).toContain("but the rules expect");
  } finally {
    await fresh.close();
  }
});
