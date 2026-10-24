import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { compileProject } from "../src/compile.ts";

/**
 * The SQL that accepted rules compile to. The cases live in tests/parity/, one
 * file per case, where tests/parity.test.ts also proves each one agrees with its
 * TypeScript; here we check the *shape* of what is emitted, which parity alone
 * cannot see (a quoted identifier, a guarded CREATE TYPE, the form of a CASE).
 */

const PROJECT = "tests/parity/tsconfig.json";

/** Compile a single case, so each assertion sees only its own SQL. */
async function compileCase(file: string, emit: Parameters<typeof compileProject>[0]["emit"] = { schema: "app" }) {
  const target = resolve("tests/parity", file);
  const result = await compileProject({
    tsconfig: PROJECT,
    include: (fileName) => resolve(fileName) === target,
    emit,
  });
  expect(result.errors.map((e) => e.format())).toEqual([]);
  expect(result.ok).toBe(true);
  return result;
}

describe("compiling a project", () => {
  test("produces the SQL documented in the readme", async () => {
    const result = await compileCase("readmeRule.ts", { schema: undefined, orReplace: false, comments: false });
    expect(result.diagnostics).toEqual([]);
    expect(result.sql).toContain(
      `CREATE FUNCTION can_create_todo(
  plan text,
  count integer
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  RETURN plan <> 'free' OR count < 3;
END;
$$;`,
    );
  });

  test("every accepted case compiles together, as one project", async () => {
    // Each case is its own file, but they share one SQL namespace: function and
    // type names must stay unique across tests/parity/.
    const result = await compileProject({ tsconfig: PROJECT, emit: { schema: "app" } });
    expect(result.errors.map((e) => e.format())).toEqual([]);
    expect(result.ok).toBe(true);
  });

  test("naming files narrows the build to those rules", async () => {
    const result = await compileProject({
      tsconfig: PROJECT,
      files: ["tests/parity/callBetweenRules.ts"],
      emit: { schema: "app" },
    });
    expect(result.errors.map((e) => e.format())).toEqual([]);
    expect(result.functions.map((fn) => fn.sqlName).sort()).toEqual(["plan_cap", "remaining_todos"]);
  });

  test("naming a file the project does not hold is an error, not an empty build", async () => {
    // Reporting success having translated nothing is the quiet wrongness this
    // compiler exists to refuse, so a misspelled path has to say so.
    const failure = await compileProject({
      tsconfig: PROJECT,
      files: ["tests/parity/nope.ts"],
      emit: { schema: "app" },
    }).then(
      () => undefined,
      (error: Error) => error,
    );
    expect(failure?.message).toContain("`tests/parity/nope.ts` is not a rule file in tests/parity/tsconfig.json");
    // The message names what the project does hold, so the fix is visible.
    expect(failure?.message).toContain("tests/parity/ifElseChain.ts");
  });
});

describe("types", () => {
  test("resolves the Integer alias instead of widening to double precision", async () => {
    const result = await compileCase("readmeRule.ts");
    const fn = result.functions.find((f) => f.tsName === "canCreateTodo")!;
    expect(fn.params.map((p) => (p.type.kind === "scalar" ? p.type.sql : p.type.sqlName))).toEqual(["text", "integer"]);
  });

  test("an identically named local alias is not mistaken for the real Integer", async () => {
    // Provenance is the package the declaration belongs to, so a rules file
    // with its own `type Integer = number` gets `number`'s mapping. Were this
    // to resolve by name, the generated column would silently be `integer`.
    const result = await compileCase("localIntegerAlias.ts");
    const fn = result.functions.find((f) => f.tsName === "doubledWeight")!;
    expect(fn.params[0]!.type).toMatchObject({ sql: "double precision" });
    expect(fn.returns).toMatchObject({ sql: "double precision" });
  });

  test("keeps the values of a string-literal union for the reader", async () => {
    const result = await compileCase("ifElseChain.ts");
    const fn = result.functions.find((f) => f.tsName === "todoLimit")!;
    expect(fn.params[0]!.type).toEqual({
      kind: "scalar",
      sql: "text",
      nullable: false,
      allowed: ["enterprise", "free", "pro"],
    });
  });
});

describe("expressions and statements", () => {
  test("`x !== null` becomes IS NOT NULL", async () => {
    const result = await compileCase("nullTest.ts");
    expect(result.sql).toContain("referral IS NOT NULL");
  });

  test("a nullable comparison becomes IS DISTINCT FROM, not <>", async () => {
    const result = await compileCase("nullableEquality.ts");
    expect(result.sql).toContain("RETURN code IS DISTINCT FROM '';");
  });

  test("calls between compiled functions are schema-qualified", async () => {
    const result = await compileCase("callBetweenRules.ts");
    expect(result.sql).toContain('"limit" := app.plan_cap(plan);');
  });

  test("identifiers that are reserved words are quoted", async () => {
    const result = await compileCase("callBetweenRules.ts");
    expect(result.sql).toContain('"limit" integer;');
  });

  test("globals are detected by provenance, not by name", async () => {
    // A parameter called `Math` is a parameter, and compiles.
    const result = await compileCase("shadowedGlobal.ts");
    expect(result.sql).toContain("math double precision");
    expect(result.sql).toContain("RETURN math + 1;");
  });
});

describe("switch", () => {
  test("a switch that only returns becomes RETURN CASE … END, one WHEN per label", async () => {
    // SQL's CASE expression takes one value per WHEN, so grouped labels repeat the result.
    const result = await compileCase("switchReturn.ts");
    expect(result.sql).toContain(`  RETURN CASE tier
    WHEN 'free' THEN 1
    WHEN 'starter' THEN 1
    WHEN 'pro' THEN 10
    ELSE 100
  END;`);
  });

  test("keeps the simple form for a nullable discriminant", async () => {
    // NULL = 'bob' is not true, so a NULL name reaches the ELSE, as null === "bob" is false.
    const result = await compileCase("switchNullableSubject.ts");
    expect(result.sql).toContain(`  RETURN CASE name
    WHEN 'bob' THEN 'hi bob'
    ELSE 'hi'
  END;`);
  });

  test("uses the searched form for case null", async () => {
    const result = await compileCase("switchCaseNull.ts");
    expect(result.sql).toContain(`  RETURN CASE
    WHEN code IS NULL THEN 'none'
    WHEN code IS NOT DISTINCT FROM 'a' THEN 'alpha'
    ELSE 'other'
  END;`);
  });

  test("a branch doing more than return keeps the CASE statement, with grouped labels", async () => {
    const result = await compileCase("switchStatementForm.ts");
    expect(result.sql).toContain(`  CASE tier
    WHEN 'free', 'starter' THEN
      off := 5;
      RETURN amount - off;
    ELSE
      RETURN amount;
  END CASE;`);
  });

  test("the searched form also exists as a statement", async () => {
    const result = await compileCase("switchSearchedStatement.ts");
    expect(result.sql).toContain(`  CASE
    WHEN code IS NULL THEN
      word := 'none';
      RETURN word;
    ELSE
      RETURN 'some';
  END CASE;`);
  });

  test("evaluates a computed discriminant once and fills an empty branch with NULL;", async () => {
    const result = await compileCase("switchEmptyDefault.ts");
    expect(result.sql).not.toContain("switch_value");
    expect(result.sql).toContain(`  CASE n % 3
    WHEN 0 THEN
      RETURN 'fizz';
    ELSE
      NULL;
  END CASE;`);
  });
});

describe("object types", () => {
  test("a named object type becomes a composite type", async () => {
    const result = await compileCase("interfaceShape.ts");
    expect(result.composites.map((c) => c.sqlName)).toEqual(["todo_policy"]);
    expect(result.sql).toContain("CREATE TYPE app.todo_policy AS (");
    expect(result.sql).toContain("plan text");
    expect(result.sql).toContain("current_count double precision");
    expect(result.sql).toContain("policy app.todo_policy");
  });

  test("CREATE TYPE is guarded and checks the existing shape", async () => {
    const result = await compileCase("interfaceShape.ts");
    expect(result.sql).toContain("IF to_regtype('app.todo_policy') IS NULL THEN");
    expect(result.sql).toContain("RAISE EXCEPTION");
  });

  test("the composite is read with a parenthesised field reference", async () => {
    const result = await compileCase("compositeParam.ts");
    expect(result.sql).toContain("plan := (sub).plan;");
    expect(result.sql).toContain("sub app.subscription");
  });

  test("types are emitted before the functions that use them", async () => {
    const result = await compileCase("compositeParam.ts");
    expect(result.sql.indexOf("CREATE TYPE app.subscription")).toBeLessThan(result.sql.indexOf("sub app.subscription"));
  });
});

describe("nested object types", () => {
  test("an anonymous nested shape flattens to a prefixed column", async () => {
    // The inner shape needs no name of its own: only the column does.
    const result = await compileCase("nestedAnonymous.ts");
    expect(result.composites[0]!.fields).toEqual([
      { path: ["foo", "bar"], sqlName: "foo_bar", type: { kind: "scalar", sql: "text", nullable: false } },
    ]);
    expect(result.sql).toContain("foo_bar text");
    expect(result.sql).toContain("RETURN (nested).foo_bar;");
  });

  test("a named nested type flattens the same way", async () => {
    const result = await compileCase("nestedObject.ts");
    // One flat type, not one per level — and no app.inner.
    expect(result.composites.map((c) => c.sqlName)).toEqual(["outer"]);
    expect(result.composites[0]!.fields.map((f) => f.sqlName)).toEqual(["label", "inner_count"]);
    expect(result.sql).toContain("inner_count double precision");
    // `outer` is a keyword PostgreSQL accepts as a parameter name but not as a
    // column reference, so it is quoted everywhere.
    expect(result.sql).toContain('("outer").inner_count > 10');
    expect(result.sql).toContain('"outer" app."outer"');
  });

  test("a nested shape rebuilt with spreads becomes one ROW", async () => {
    const result = await compileCase("nestedSpread.ts");
    expect(result.sql).toContain("CREATE TYPE app.nested AS (");
    expect(result.sql).toContain("foo_bar text");
    // The rule rebuilds the shape with a spread rather than mutating it.
    expect(result.sql).toContain("_nested := ROW('some')::app.nested;");
    expect(result.sql).toContain("RETURN _nested;");
  });
});

describe("object literals and spread", () => {
  test("a spread rebuild compiles where mutation does not", async () => {
    const result = await compileCase("spreadUpdate.ts");
    // The nested spread supplies foo_bar, then `bar: "some"` overrides it.
    expect(result.sql).toContain("next := ROW('some')::app.mutable;");
    expect(result.sql).toContain("RETURN (next).foo_bar;");
  });

  test("a function can return a composite built from a spread", async () => {
    const result = await compileCase("spreadReturn.ts");
    expect(result.sql).toContain("RETURNS app.seat");
    // One ROW argument per flattened field, in field order.
    expect(result.sql).toContain("RETURN ROW((seat).plan, (seat).count + 1)::app.seat;");
  });

  test("a field can be read off a call that returns a composite", async () => {
    const result = await compileCase("spreadReturn.ts");
    expect(result.sql).toContain("RETURN (app.grant_seat(seat)).count;");
  });

  test("the composite type a return value needs is emitted", async () => {
    const result = await compileCase("spreadReturn.ts");
    expect(result.composites.map((c) => c.sqlName)).toEqual(["seat"]);
  });

  test("a composite can be returned unchanged", async () => {
    const result = await compileCase("compositeReturn.ts");
    expect(result.sql).toContain("RETURNS app.plan");
    expect(result.sql).toContain("RETURN plan;");
  });

  test("a nested group can be passed by spreading it into a literal", async () => {
    // `barOf(crate.foo)` is still rejected — the group has no column — but
    // `barOf({ ...crate.foo })` rebuilds it, which does.
    const result = await compileCase("groupSpread.ts");
    expect(result.sql).toContain("RETURN app.bar_of(ROW((crate).foo_bar)::app.content);");
  });
});
