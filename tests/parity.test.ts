import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { compileProject, formatResult, type ManifestFunction } from "../src/compile.ts";
import { checkParity, type RowQuery } from "../src/parity.ts";
import { openDatabase, type Database } from "../src/runParity.ts";

/**
 * The parity harness, run on every accepted case in tests/parity/ (one file per
 * case) — never on examples/, which is the user-facing showcase and is checked
 * by `bun run ex:parity` in CI instead.
 *
 * Every check runs on each backend `tsql parity` supports: PGlite always, and
 * a real PostgreSQL when TSQL_TEST_DB_URL names one (CI provides it). The
 * databases are opened through the same `openDatabase` the command uses, so
 * the PostgreSQL run also proves the transaction-and-rollback path.
 *
 * That the harness *can* fail is proven separately, in tests/divergent.test.ts.
 */

const SCHEMA = "app";
const rules = await compileProject({ tsconfig: "tests/parity/tsconfig.json", emit: { schema: SCHEMA } });

// Parity needs SQL to compare against, so a project that does not compile is
// reported as one failing test carrying the compiler's own message — rather
// than a module-scope throw, which would bury it under cascading failures.
test("the parity cases compile", () => {
  expect(formatResult(rules)).toBe("");
});

test("every compiled function is covered", () => {
  expect(rules.manifest.functions.length).toBe(rules.functions.length);
  expect(rules.manifest.functions.length).toBeGreaterThan(0);
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
  const runnable = rules.ok && (backend.name === "PGlite" || backend.url !== undefined);

  describe.skipIf(!runnable)(`parity on ${backend.name}`, () => {
    let db: Database;
    const query: RowQuery = (sql, params) => db.query(sql, params);

    beforeAll(async () => {
      db = await openDatabase(backend.url);
      await db.exec(rules.sql);
    });

    afterAll(async () => {
      await db?.close();
    });

    // One generated test per compiled function. The list comes from the
    // manifest, so adding a case to tests/parity/ adds a parity test with no
    // edit here.
    for (const fn of rules.manifest.functions) {
      test(`${fn.tsName}() === ${SCHEMA}.${fn.sqlName}()`, async () => {
        await checkParity(fn, await implementation(fn), query, SCHEMA);
      });
    }
  });
}
