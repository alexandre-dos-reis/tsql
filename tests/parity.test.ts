import { PGlite } from "@electric-sql/pglite";
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

    // Negative control: a harness that cannot fail proves nothing. This installs a
    // function that disagrees with its TypeScript twin on one input and asserts the
    // parity check finds it.
    test("parity checking actually detects a divergence", async () => {
      await db.exec(`CREATE FUNCTION app.wrong_limit(plan text) RETURNS integer
LANGUAGE plpgsql IMMUTABLE AS $$ BEGIN
  IF plan = 'free' THEN RETURN 4; END IF;
  RETURN 1000;
END; $$;`);

      const subject = {
        tsName: "todoLimit",
        sqlName: "wrong_limit",
        module: "tests/parity/ifElseChain.ts",
        params: [
          {
            tsName: "plan",
            sqlName: "plan",
            type: { kind: "scalar" as const, sql: "text" as const, nullable: false, allowed: ["free", "pro"] },
          },
        ],
        returns: { kind: "scalar" as const, sql: "integer" as const, nullable: false },
      };
      const { todoLimit } = await import(resolve("tests/parity/ifElseChain.ts"));

      const failure = await checkParity(subject, todoLimit, query, SCHEMA).then(
        () => undefined,
        (error: Error) => error,
      );
      expect(failure?.message).toContain('todoLimit("free") diverges: TypeScript gave 3, PostgreSQL gave 4');
    });

    // The reason copy-at-the-top was the wrong fix for field mutation: return
    // values agree, so only an explicit check on the arguments can see it.
    test("parity detects a TypeScript function that mutates its argument", async () => {
      const subject = rules.manifest.functions.find((f) => f.tsName === "grantSeat")!;
      const mutating = (seat: { plan: string; count: number }) => {
        seat.count = seat.count + 1;
        return seat;
      };

      const failure = await checkParity(subject, mutating as never, query, SCHEMA).then(
        () => undefined,
        (error: Error) => error,
      );
      expect(failure?.message).toContain("mutated its arguments");
      expect(failure?.message).toContain("build a new value instead");
    });

    test("the migration is re-runnable", async () => {
      // CREATE OR REPLACE for functions, a guarded CREATE for types.
      await db.exec(rules.sql);
      await db.exec(rules.sql);
      const row = await query("select app.can_create_todo_with_type(ROW('free')::app.subscription, 3) as ok", []);
      expect(row.ok).toBe(true);
    });
  });
}

// Needs an empty database with a conflicting type already in it, so it uses a
// fresh PGlite rather than a shared backend.
test.skipIf(!rules.ok)("a composite type that drifted from the rules fails the migration", async () => {
  const fresh = await PGlite.create();
  await fresh.exec("CREATE SCHEMA app; CREATE TYPE app.subscription AS (plan text, stale integer);");
  const failure = await fresh.exec(rules.sql).then(
    () => undefined,
    (error: Error) => error,
  );
  expect(failure?.message).toContain("app.subscription exists as");
  expect(failure?.message).toContain("but the rules expect");
  await fresh.close();
});
