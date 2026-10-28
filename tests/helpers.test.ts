import { PGlite } from "@electric-sql/pglite";
import { resolve } from "node:path";
import { describe, expect, test } from "bun:test";
import { compileProject } from "../src/compile.ts";
import { HELPER_HASHES } from "../src/helpersLock.ts";
import {
  HELPERS,
  HELPERS_REVISION,
  helperFingerprint,
  runtimeSql,
  TSQL_SCHEMA,
  type HelperName,
} from "../src/helpers.ts";

/**
 * The functions tsql installs in the `tsql` schema (`src/helpers.ts`,
 * `docs/design.md` "The `tsql` schema"): what pins their text, how a migration
 * installs them, and what it refuses.
 *
 * What the helpers *return* is `tests/parity` and `tests/specialValues.test.ts`: both run
 * the whole migration, runtime section included.
 */

const ALL = Object.keys(HELPERS) as HelperName[];

describe("the text of the helpers is locked to a revision", () => {
  test("the last recorded revision is the helpers as they are", () => {
    // Changing a helper without recording it lands here: an IMMUTABLE function whose
    // body changed under an index is what the revision exists to announce.
    expect(
      helperFingerprint(),
      "A helper in src/helpers.ts changed. Run `bun scripts/helpers.ts lock` to record the new revision, and say in a changeset which Math functions behave differently.",
    ).toBe(HELPER_HASHES.at(-1)!);
  });

  test("the revision is how many are recorded, and none is recorded twice", () => {
    expect(HELPERS_REVISION).toBe(HELPER_HASHES.length);
    expect(new Set(HELPER_HASHES).size).toBe(HELPER_HASHES.length);
  });
});

describe("a migration brings the helpers up to date", () => {
  const apply = (db: PGlite, notices: string[] = []) =>
    db.exec(runtimeSql(ALL), {
      // `IF NOT EXISTS` notices are PostgreSQL's own; the ones that matter start with "tsql:".
      onNotice: (notice: { message?: string | undefined }) => {
        if (notice.message?.startsWith("tsql:")) notices.push(notice.message);
      },
    });

  test("it can be applied twice, and records the revision once", async () => {
    const db = new PGlite();
    await apply(db);
    await apply(db);
    const rows = await db.query<{ revision: number }>(`SELECT revision FROM ${TSQL_SCHEMA}.runtime`);
    expect(rows.rows).toEqual([{ revision: HELPERS_REVISION }]);
    const count = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = '${TSQL_SCHEMA}'`,
    );
    expect(count.rows[0]!.n).toBe(ALL.length);
  });

  test("it says nothing when nothing changed", async () => {
    const db = new PGlite();
    await apply(db);
    const notices: string[] = [];
    await apply(db, notices);
    expect(notices).toEqual([]);
  });

  test("a helper that differs is replaced, and announced", async () => {
    const db = new PGlite();
    await apply(db);
    await db.exec(
      `CREATE OR REPLACE FUNCTION ${TSQL_SCHEMA}.math_round(x double precision) RETURNS double precision LANGUAGE sql IMMUTABLE AS $$ SELECT 0::double precision $$`,
    );
    const notices: string[] = [];
    await apply(db, notices);
    expect(notices).toHaveLength(1);
    expect(notices[0]).toContain("tsql.math_round(double precision)");
    expect(notices[0]).toContain("Rebuild");
    const row = await db.query<{ v: number }>(`SELECT ${TSQL_SCHEMA}.math_round(2.5) AS v`);
    expect(row.rows[0]!.v).toBe(3);
  });

  test("a database holding a newer revision refuses it, and keeps what it has", async () => {
    const db = new PGlite();
    await apply(db);
    await db.exec(`UPDATE ${TSQL_SCHEMA}.runtime SET revision = ${HELPERS_REVISION + 1}`);
    await expect(apply(db)).rejects.toThrow(/newer than the revision/);
    const row = await db.query<{ revision: number }>(`SELECT revision FROM ${TSQL_SCHEMA}.runtime`);
    expect(row.rows[0]!.revision).toBe(HELPERS_REVISION + 1);
  });

  test("a helper stays inlinable: a SET clause would turn the planner away", async () => {
    const db = new PGlite();
    await apply(db);
    // A column, not a constant: a constant is folded whether or not the function inlines.
    await db.exec("CREATE TEMP TABLE sample (x double precision)");
    const plan = await db.query<{ "QUERY PLAN": string }>(
      `EXPLAIN (VERBOSE, COSTS OFF) SELECT ${TSQL_SCHEMA}.math_round(x) FROM sample`,
    );
    const text = plan.rows.map((row) => row["QUERY PLAN"]).join("\n");
    expect(text).not.toContain(`${TSQL_SCHEMA}.math_round(`);
    expect(text).toContain("CASE");
  });

  // The hexadecimal side was once an aggregate over the digits, which needs a
  // FROM and so cannot inline: measured at 15.2 µs a call against 1.2 µs for
  // the form that replaced it. Nothing about `integer` needs that generality —
  // more than eight significant hexadecimal digits cannot fit one whatever they
  // are — so losing it again would be a regression worth failing for.
  test("number_parse_int stays inlinable: an aggregate over the digits would not", async () => {
    const db = new PGlite();
    await apply(db);
    await db.exec("CREATE TEMP TABLE texts (s text)");
    const plan = await db.query<{ "QUERY PLAN": string }>(
      `EXPLAIN (VERBOSE, COSTS OFF) SELECT ${TSQL_SCHEMA}.number_parse_int(s, 10) FROM texts`,
    );
    const text = plan.rows.map((row) => row["QUERY PLAN"]).join("\n");
    expect(text).not.toContain(`${TSQL_SCHEMA}.number_parse_int(`);
    expect(text).toContain("CASE");
  });
});

describe("what a build writes", () => {
  const build = (file: string, schema = "app") =>
    compileProject({
      tsconfig: "tests/parity/tsconfig.json",
      include: (name) => resolve(name) === resolve(file),
      emit: { schema },
    });

  test("only the helpers its functions call", async () => {
    // `mathConstants.ts` calls `Math.min` once, and nothing else.
    const result = await build("tests/parity/mathConstants.ts");
    expect(result.sql).toContain("CREATE OR REPLACE FUNCTION tsql.math_min(");
    expect(result.sql).not.toContain("CREATE OR REPLACE FUNCTION tsql.math_round(");
    const some = await build("tests/parity/mathFunctions.ts");
    for (const name of [
      "math_min",
      "math_max",
      "math_round",
      "math_fround",
      "math_sign",
      "math_sqrt",
      "math_clz32",
      "math_imul",
    ]) {
      expect(some.sql).toContain(`CREATE OR REPLACE FUNCTION tsql.${name}(`);
    }
  });

  test("none, and no runtime section, when no function calls one", async () => {
    const result = await build("tests/parity/doubleNegation.ts");
    expect(result.sql).not.toContain("tsql.runtime");
    expect(result.sql).not.toContain("DO $tsql$");
  });

  test("the runtime section comes before the functions that call it", async () => {
    const result = await build("tests/parity/mathFunctions.ts");
    expect(result.sql.indexOf("tsql.runtime")).toBeLessThan(result.sql.indexOf("CREATE OR REPLACE FUNCTION app."));
  });

  test("the schema is reserved", async () => {
    await expect(build("tests/parity/mathFunctions.ts", TSQL_SCHEMA)).rejects.toThrow(/reserved/);
  });
});
