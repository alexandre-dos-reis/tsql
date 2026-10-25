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
 * This file holds no cases. Each case is a pair: `name.ts`, the functions, and
 * `name.sql`, the SQL it must compile to. For each case:
 *
 * 1. compiled alone, its SQL contains each block of `name.sql` (blocks are
 *    separated by a blank line; a block of comments only is ignored), in order,
 *    each block as consecutive lines — indentation aside. This pins the *shape*
 *    of the SQL, which parity cannot see: a quoted identifier, the form of a
 *    CASE, the types in a signature. `name.sql` lists the types and functions
 *    only, without the type guard's boilerplate or the provenance comments;
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

/** Lines without their indentation, so the expected `.sql` can be laid out for reading. */
function lines(text: string): string[] {
  return text.split("\n").map((line) => line.trim());
}

/** Blocks of an expected `.sql`: runs of non-blank lines, separated by blank lines. A block of comments only is a note to the reader, not SQL to find. */
function blocks(text: string): string[][] {
  return text
    .split(/\n\s*\n/)
    .map((block) => lines(block).filter((line) => line !== ""))
    .filter((block) => block.length > 0 && !block.every((line) => line.startsWith("--")));
}

describe("each case compiles to its .sql", () => {
  for (const name of cases) {
    test(name, async () => {
      const path = resolve(DIR, `${name}.ts`);
      const expected = readFileSync(resolve(DIR, `${name}.sql`), "utf8");

      const result = await compileProject({
        tsconfig: TSCONFIG,
        include: (fileName) => resolve(fileName) === path,
        emit: { schema: SCHEMA },
      });
      expect(formatResult(result)).toBe("");

      // Each block as consecutive lines, the blocks in order.
      const emitted = lines(result.sql);
      let from = 0;
      for (const block of blocks(expected)) {
        let at = -1;
        for (let i = from; i + block.length <= emitted.length && at === -1; i++) {
          if (block.every((line, k) => emitted[i + k] === line)) at = i;
        }
        if (at === -1) {
          throw new Error(`${DIR}/${name}.ts: this block of ${name}.sql was not emitted (in order):\n\n${block.join("\n")}\n\nEmitted:\n\n${result.sql}`);
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

// The type guard must refuse a database whose type no longer matches the functions,
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
    expect(failure?.message).toContain("but the functions expect");
  } finally {
    await fresh.close();
  }
});

// Domains and enums converge on the TypeScript, never destructively. Each needs
// the type already there in some other shape, so a fresh PGlite each time.
async function applyOver(setup: string): Promise<{ db: PGlite; failure: Error | undefined }> {
  const db = await PGlite.create();
  await db.exec(`CREATE SCHEMA app; ${setup}`);
  const failure = await db.exec(project.sql).then(
    () => undefined,
    (error: Error) => error,
  );
  return { db, failure };
}

test.skipIf(!project.ok)("the migration adds an enum value in its place", async () => {
  const { db, failure } = await applyOver("CREATE TYPE app.area_type AS ENUM ('level-1', 'level-3');");
  try {
    expect(failure).toBeUndefined();
    const { rows } = await db.query<{ labels: string }>("SELECT enum_range(NULL::app.area_type)::text AS labels");
    expect(rows[0]!.labels).toBe("{level-1,level-2,level-3}");
  } finally {
    await db.close();
  }
});

test.skipIf(!project.ok)("the migration refuses an enum that has a value the functions removed", async () => {
  const { db, failure } = await applyOver("CREATE TYPE app.area_type AS ENUM ('level-1', 'level-2', 'level-3', 'legacy');");
  try {
    expect(failure?.message).toContain("a value was removed or renamed");
  } finally {
    await db.close();
  }
});

test.skipIf(!project.ok)("the migration narrows a domain, and refuses while rows use a removed value", async () => {
  const wider = "CREATE DOMAIN app.zone AS text CONSTRAINT zone_values CHECK (VALUE = ANY (ARRAY['east', 'north', 'south']));";

  const unused = await applyOver(wider);
  try {
    expect(unused.failure).toBeUndefined();
    const refused = await unused.db.query("SELECT 'east'::app.zone").then(
      () => undefined,
      (error: Error) => error,
    );
    expect(refused?.message).toContain("zone_values");
  } finally {
    await unused.db.close();
  }

  const used = await applyOver(`${wider} CREATE TABLE places (zone app.zone); INSERT INTO places VALUES ('east');`);
  try {
    // ALTER DOMAIN … ADD CONSTRAINT re-checks every column of the domain.
    expect(used.failure?.message).toContain("violate the new constraint");
  } finally {
    await used.db.close();
  }
});
