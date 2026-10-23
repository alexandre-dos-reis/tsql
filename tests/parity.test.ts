import { PGlite } from "@electric-sql/pglite";
import { afterAll, expect, test } from "bun:test";
import { resolve } from "node:path";
import { compileProject, formatResult } from "../src/compile.ts";
import { checkParity, type RowQuery } from "../src/parity.ts";

const SCHEMA = "app";

const result = await compileProject({ tsconfig: "examples/rules/tsconfig.json", emit: { schema: SCHEMA } });

// Parity needs SQL to compare against, so a rules project that does not compile
// is reported as one failing test carrying the compiler's own message — rather
// than a module-scope throw, which buries the real error under cascading
// failures in every other test that reads examples/rules/.
if (!result.ok) {
  test("examples/rules/ must compile before parity can run", () => {
    expect(formatResult(result)).toBe("");
  });
} else {
  // PGlite is PostgreSQL compiled to WebAssembly: a real planner and a real
  // PL/pgSQL, in process, with no server to manage.
  const db = await PGlite.create();
  await db.exec(result.sql);

  const query: RowQuery = async (sql, params) => {
    const rows = await db.query<Record<string, unknown>>(sql, [...params]);
    return rows.rows[0]!;
  };

  afterAll(async () => {
    await db.close();
  });

  test("every compiled function is covered", () => {
    expect(result.manifest.functions.length).toBe(result.functions.length);
    expect(result.manifest.functions.length).toBeGreaterThan(0);
  });

  // One generated test per compiled function. The list comes from the manifest,
  // so adding a rule under examples/rules/ adds a parity test with no edit here.
  for (const fn of result.manifest.functions) {
    test(`${fn.tsName}() === ${SCHEMA}.${fn.sqlName}()`, async () => {
      const module = (await import(resolve(fn.module))) as Record<string, (...args: never[]) => unknown>;
      const impl = module[fn.tsName];
      expect(typeof impl).toBe("function");
      await checkParity(fn, impl!, query, result.manifest.schema);
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
      module: "examples/rules/billing.ts",
      params: [
        {
          tsName: "plan",
          sqlName: "plan",
          type: { kind: "scalar" as const, sql: "text" as const, nullable: false, allowed: ["free", "pro"] },
        },
      ],
      returns: { kind: "scalar" as const, sql: "integer" as const, nullable: false },
    };
    const { todoLimit } = await import(resolve("examples/rules/billing.ts"));

    const failure = await checkParity(subject, todoLimit, query, SCHEMA).then(
      () => undefined,
      (error: Error) => error,
    );
    expect(failure?.message).toContain('todoLimit("free") diverges: TypeScript gave 3, PostgreSQL gave 4');
  });

  test("the migration is re-runnable", async () => {
    // CREATE OR REPLACE for functions, a guarded CREATE for types.
    await db.exec(result.sql);
    await db.exec(result.sql);
    const rows = await db.query<{ ok: boolean }>(
      "select app.can_create_todo_with_type(ROW('free')::app.subscription, 3) as ok",
    );
    expect(rows.rows[0]!.ok).toBe(true);
  });

  test("a composite type that drifted from the rules fails the migration", async () => {
    const fresh = await PGlite.create();
    await fresh.exec("CREATE SCHEMA app; CREATE TYPE app.subscription AS (plan text, stale integer);");
    const failure = await fresh.exec(result.sql).then(
      () => undefined,
      (error: Error) => error,
    );
    expect(failure?.message).toContain("app.subscription exists as");
    expect(failure?.message).toContain("but the rules expect");
    await fresh.close();
  });
}

// Composite returns and the argument-mutation check are exercised against a
// fixture rather than examples/rules/, so this coverage holds even while examples/rules/ is
// mid-edit.
const fixture = await compileProject({
  tsconfig: "tests/fixtures/tsconfig.json",
  include: (fileName) => fileName.endsWith("tests/fixtures/spreadReturn.ts"),
  emit: { schema: SCHEMA },
});

test("the spread fixture compiles", () => {
  expect(formatResult(fixture)).toBe("");
});

if (fixture.ok) {
  const fixtureDb = await PGlite.create();
  await fixtureDb.exec(fixture.sql);
  const fixtureQuery: RowQuery = async (sql, params) =>
    (await fixtureDb.query<Record<string, unknown>>(sql, [...params])).rows[0]!;

  afterAll(async () => {
    await fixtureDb.close();
  });

  for (const fn of fixture.manifest.functions) {
    test(`${fn.tsName}() === ${SCHEMA}.${fn.sqlName}()`, async () => {
      const module = (await import(resolve(fn.module))) as Record<string, (...args: never[]) => unknown>;
      await checkParity(fn, module[fn.tsName]!, fixtureQuery, fixture.manifest.schema);
    });
  }

  // The reason copy-at-the-top was the wrong fix: return values agree, so only
  // an explicit check on the arguments can see the divergence.
  test("parity detects a TypeScript function that mutates its argument", async () => {
    const subject = fixture.manifest.functions.find((f) => f.tsName === "grantSeat")!;
    const mutating = (seat: { plan: string; count: number }) => {
      seat.count = seat.count + 1;
      return seat;
    };

    const failure = await checkParity(subject, mutating as never, fixtureQuery, SCHEMA).then(
      () => undefined,
      (error: Error) => error,
    );
    expect(failure?.message).toContain("mutated its arguments");
    expect(failure?.message).toContain("build a new value instead");
  });
}
