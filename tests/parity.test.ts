import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { compileProject, formatResult, type ManifestFunction } from "../src/compile.ts";
import { checkParity, type RowQuery } from "../src/parity.ts";
import { openDatabase, type Database } from "../src/runParity.ts";

/**
 * Every case in tests/parity/ is accepted by the compiler and agrees with its
 * TypeScript.
 *
 * This file holds no cases. Each case is a file, `name.ts`, and for each one:
 *
 * 1. compiled alone, its SQL contains each `Expected SQL:` line of its header, in
 *    order — the *shape* of the SQL, which parity cannot see (a quoted
 *    identifier, the form of a CASE, the types in a signature). Cases where the
 *    shape does not matter have none;
 * 2. every function in it agrees with its TypeScript on 200 random inputs, on
 *    PGlite and, when TSQL_TEST_DB_URL names one, on a real PostgreSQL — through
 *    the same `openDatabase` that `tsql parity` uses.
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

describe("each case compiles to the SQL its header expects", () => {
  for (const name of cases) {
    test(name, async () => {
      const path = resolve(DIR, `${name}.ts`);
      const expected = [...readFileSync(path, "utf8").matchAll(/^ \* Expected SQL: (.+)$/gm)].map((m) => m[1]!);

      const result = await compileProject({
        tsconfig: TSCONFIG,
        include: (fileName) => resolve(fileName) === path,
        emit: { schema: SCHEMA },
      });
      expect(formatResult(result)).toBe("");

      // In order: each fragment must appear after the previous one.
      let from = 0;
      for (const fragment of expected) {
        const at = result.sql.indexOf(fragment, from);
        if (at === -1) {
          throw new Error(`${DIR}/${name}.ts: expected, after position ${from}, the SQL\n  ${fragment}\nin\n${result.sql}`);
        }
        from = at + fragment.length;
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
