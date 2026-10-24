import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { compileProject, formatResult, type ManifestFunction } from "../src/compile.ts";
import { checkParity, type RowQuery } from "../src/parity.ts";
import { openDatabase, type Database } from "../src/runParity.ts";

/**
 * Every case in tests/parity/ is accepted by the compiler and agrees with its
 * TypeScript.
 *
 * This file holds no cases. Each case is a pair: `name.ts`, the rule, and
 * `name.sql`, exactly the SQL the compiler must emit for it. For each case:
 *
 * 1. it compiles, to exactly `name.sql` — which pins the *shape* of the SQL,
 *    what parity cannot see (a quoted identifier, the form of a CASE, the types
 *    in the signature);
 * 2. every function in it agrees with its TypeScript on 200 random inputs, on
 *    PGlite and, when TSQL_TEST_DB_URL names one, on a real PostgreSQL — through
 *    the same `openDatabase` that `tsql parity` uses.
 *
 * After a deliberate change to the generated SQL, rewrite the `.sql` files with
 * `UPDATE_SQL=1 bun test tests/parity.test.ts` and review the diff.
 *
 * That the harness can fail at all is proven in tests/divergent.test.ts.
 */

const DIR = "tests/parity";
const TSCONFIG = `${DIR}/tsconfig.json`;
const SCHEMA = "app";
const UPDATE = process.env.UPDATE_SQL === "1";

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

describe("each case compiles to its .sql", () => {
  for (const name of cases) {
    test(name, async () => {
      const path = resolve(DIR, `${name}.ts`);
      const result = await compileProject({
        tsconfig: TSCONFIG,
        include: (fileName) => resolve(fileName) === path,
        emit: { schema: SCHEMA },
      });
      expect(formatResult(result)).toBe("");

      const expectedPath = resolve(DIR, `${name}.sql`);
      if (UPDATE) writeFileSync(expectedPath, result.sql);
      if (!existsSync(expectedPath)) {
        throw new Error(`${DIR}/${name}.sql is missing. Run UPDATE_SQL=1 bun test tests/parity.test.ts`);
      }
      expect(result.sql).toBe(readFileSync(expectedPath, "utf8"));
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
