import { beforeAll, expect, test } from "bun:test";
import { resolve } from "node:path";
import { compileProject, formatResult } from "../src/compile";
import { openDatabase, type Database } from "../src/runParity";

/**
 * A function that is one `return` is emitted as `LANGUAGE sql` so that PostgreSQL inlines it
 * (`src/language.ts`). Which ones are is checked by `tests/parity/sqlLanguage.sql`; this is the point of
 * it: the planner sees through the call, and an index on the column is used where a PL/pgSQL
 * function — the same function, the same answers — would scan the whole table.
 */

const FILE = resolve("tests/parity/sqlLanguage.ts");
const result = await compileProject({
  tsconfig: "tests/parity/tsconfig.json",
  include: (file) => resolve(file) === FILE,
  emit: { schema: "app" },
});

let db: Database;
beforeAll(async () => {
  db = await openDatabase();
  await db.exec(result.sql);
  await db.exec(`
    CREATE TABLE t (v double precision);
    INSERT INTO t SELECT (i % 1000)::double precision FROM generate_series(1, 20000) i;
    CREATE INDEX ON t (v);
    ANALYZE t;
    CREATE FUNCTION explain(query text) RETURNS text LANGUAGE plpgsql AS $$
    DECLARE line text; plan text := '';
    BEGIN
      FOR line IN EXECUTE 'EXPLAIN ' || query LOOP plan := plan || line || E'\\n'; END LOOP;
      RETURN plan;
    END; $$;
    CREATE FUNCTION app.inline_sql(x double precision) RETURNS boolean LANGUAGE sql IMMUTABLE RETURN x > 990;
    CREATE FUNCTION app.inline_plpgsql(x double precision) RETURNS boolean LANGUAGE plpgsql IMMUTABLE
      AS $$ BEGIN RETURN x > 990; END; $$;
  `);
});

async function plan(query: string): Promise<string> {
  const row = (await db.query("SELECT explain($1) AS plan", [query])) as { plan: string };
  return row.plan;
}

test("compiles", () => {
  expect(formatResult(result)).toBe("");
});

test("a compiled SQL function is inlined: the index is used and the call is gone", async () => {
  const text = await plan("SELECT count(*) FROM t WHERE app.language_above(v)");
  expect(text).toContain("Index Cond");
  expect(text).not.toContain("language_above");
});

test("the control: a PL/pgSQL function with the same body is not", async () => {
  const text = await plan("SELECT count(*) FROM t WHERE app.inline_plpgsql(v)");
  expect(text).toContain("Seq Scan");
  expect(text).toContain("inline_plpgsql");
  const inlined = await plan("SELECT count(*) FROM t WHERE app.inline_sql(v)");
  expect(inlined).not.toContain("inline_sql");
});

test("a function that calls another is created after it", () => {
  expect(result.sql.indexOf("app.language_leaf(")).toBeLessThan(result.sql.indexOf("RETURN app.language_leaf("));
});
