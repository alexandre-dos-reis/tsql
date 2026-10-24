import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { compileProject } from "../src/compile.ts";

const FIXTURES = "tests/fixtures/tsconfig.json";

/** Compile a single fixture file, so each test sees only its own errors. */
async function compileFixture(file: string) {
  const target = resolve("tests/fixtures", file);
  return compileProject({
    tsconfig: FIXTURES,
    include: (fileName) => resolve(fileName) === target,
    emit: { schema: "app" },
  });
}

describe("supported subset", () => {
  test("produces the SQL documented in the readme", async () => {
    const result = await compileProject({
      tsconfig: "examples/tsconfig.json",
      include: (fileName) => fileName.endsWith("examples/input-2.ts"),
      emit: { schema: undefined, orReplace: false, comments: false },
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.errors.map((e) => e.message)).toEqual([]);
    // Containment, not equality: the module holds other rules too.
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

  test("compiles the whole rules project", async () => {
    const result = await compileProject({ tsconfig: "examples/tsconfig.json", emit: { schema: "app" } });
    expect(result.errors.map((e) => e.format())).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.functions.map((fn) => fn.sqlName).sort()).toEqual([
      "can_create_todo",
      "can_create_todo_with_type",
      "is_eligible_for_trial",
      "is_not_empty",
      "price_cents",
      "remaining_todos",
      "seat_limit",
      "some_nested_assignment",
      "todo_limit",
    ]);
  });

  test("resolves the Integer alias instead of widening to double precision", async () => {
    const result = await compileProject({ tsconfig: "examples/tsconfig.json", emit: { schema: "app" } });
    const fn = result.functions.find((f) => f.tsName === "canCreateTodo")!;
    expect(fn.params.map((p) => (p.type.kind === "scalar" ? p.type.sql : p.type.sqlName))).toEqual(["text", "integer"]);
  });

  test("naming files narrows the build to those rules", async () => {
    const result = await compileProject({
      tsconfig: "examples/tsconfig.json",
      files: ["examples/input-1.ts"],
      emit: { schema: "app" },
    });
    expect(result.errors.map((e) => e.format())).toEqual([]);
    expect(result.functions.map((fn) => fn.sqlName).sort()).toEqual([
      "is_eligible_for_trial",
      "is_not_empty",
      "price_cents",
      "remaining_todos",
      "todo_limit",
    ]);
  });

  test("naming a file the project does not hold is an error, not an empty build", async () => {
    // Reporting success having translated nothing is the quiet wrongness this
    // compiler exists to refuse, so a misspelled path has to say so.
    const failure = await compileProject({
      tsconfig: "examples/tsconfig.json",
      files: ["examples/nope.ts"],
      emit: { schema: "app" },
    }).then(
      () => undefined,
      (error: Error) => error,
    );
    expect(failure?.message).toContain("`examples/nope.ts` is not a rule file in examples/tsconfig.json");
    // The message names what the project does hold, so the fix is visible.
    expect(failure?.message).toContain("examples/input-1.ts");
  });

  test("an identically named local alias is not mistaken for the real Integer", async () => {
    // Provenance is the package the declaration belongs to, so a rules file
    // with its own `type Integer = number` gets `number`'s mapping. Were this
    // to resolve by name, the generated column would silently be `integer`.
    const result = await compileFixture("localIntegerAlias.ts");
    expect(result.errors.map((e) => e.format())).toEqual([]);
    expect(result.ok).toBe(true);
    const fn = result.functions.find((f) => f.tsName === "shippingCents")!;
    expect(fn.params[0]!.type).toMatchObject({ sql: "double precision" });
    expect(fn.returns).toMatchObject({ sql: "double precision" });
  });

  test("keeps the values of a string-literal union for the reader", async () => {
    const result = await compileProject({ tsconfig: "examples/tsconfig.json", emit: { schema: "app" } });
    const fn = result.functions.find((f) => f.tsName === "todoLimit")!;
    expect(fn.params[0]!.type).toEqual({
      kind: "scalar",
      sql: "text",
      nullable: false,
      allowed: ["enterprise", "free", "pro"],
    });
  });

  test("translates a nullable comparison to IS DISTINCT FROM, not <>", async () => {
    const result = await compileProject({ tsconfig: "examples/tsconfig.json", emit: { schema: "app" } });
    expect(result.sql).toContain("referral IS NOT NULL");
  });

  test("schema-qualifies calls between compiled functions", async () => {
    const result = await compileProject({ tsconfig: "examples/tsconfig.json", emit: { schema: "app" } });
    expect(result.sql).toContain('"limit" := app.todo_limit(plan);');
  });

  test("quotes identifiers that are reserved words", async () => {
    const result = await compileProject({ tsconfig: "examples/tsconfig.json", emit: { schema: "app" } });
    expect(result.sql).toContain('"limit" integer;');
  });
});

function rejects(cases: [file: string, expected: string][]) {
  for (const [file, expected] of cases) {
    test(`${file} is rejected at build time`, async () => {
      const result = await compileFixture(file);
      expect(result.diagnostics).toEqual([]);
      expect(result.ok).toBe(false);
      expect(result.sql).toBe("");
      expect(result.errors.map((e) => e.message).join("\n")).toContain(expected);
    });
  }
}

describe("rejections — language constructs", () => {
  rejects([
    ["truthiness.ts", "Truthiness is not translated"],
    ["mutable.ts", "Only `const` declarations are supported"],
    ["loops.ts", "WhileStatement is not supported"],
    ["assignment.ts", "Assignment is not supported"],
    ["discardedStatement.ts", "value is discarded, which has no effect in a pure function"],
    ["textOrder.ts", "Ordering comparisons are only supported on numbers"],
    ["floatMod.ts", "`%` is not defined for `double precision`"],
    ["optional.ts", "Optional parameters are not supported"],
    ["inferredReturn.ts", "Add an explicit return type"],
    ["looseEquality.ts", "Use `===` / `!==`"],
    ["unsupportedType.ts", "`Date` is a built-in JavaScript type"],
    ["undefinedType.ts", "`undefined` has no SQL equivalent"],
    ["generic.ts", "Generic functions are not supported"],
    ["switchFallthrough.ts", "falls through into the next one"],
    ["switchBreak.ts", "`break` is only supported as the last statement of a `switch` clause"],
    ["switchObject.ts", "a `switch` on an object has no faithful translation"],
    ["switchNoDefault.ts", "A `switch` needs a `default`"],
  ]);

  test("a rejection points at the offending line", async () => {
    const result = await compileFixture("truthiness.ts");
    const error = result.errors[0]!;
    expect(error.fileName).toEndWith("tests/fixtures/truthiness.ts");
    expect(error.line).toBe(2);
    expect(error.format()).toContain("if (name) {");
  });
});

describe("switch", () => {
  test("becomes a simple CASE, with grouped labels and default as ELSE", async () => {
    const result = await compileFixture("switchStatement.ts");
    expect(result.errors.map((e) => e.format())).toEqual([]);
    expect(result.sql).toContain(`  CASE tier
    WHEN 'free', 'starter' THEN
      RETURN 1;
    WHEN 'pro' THEN
      RETURN 10;
    ELSE
      RETURN 100;
  END CASE;`);
  });

  test("keeps the simple form for a nullable discriminant", async () => {
    // NULL = 'bob' is not true, so a NULL name reaches the ELSE, as null === "bob" is false.
    const result = await compileFixture("switchStatement.ts");
    expect(result.sql).toContain(`  CASE name
    WHEN 'bob' THEN`);
  });

  test("uses the searched form for case null", async () => {
    const result = await compileFixture("switchStatement.ts");
    expect(result.sql).toContain(`  CASE
    WHEN code IS NULL THEN
      RETURN 'none';
    WHEN code IS NOT DISTINCT FROM 'a' THEN
      RETURN 'alpha';
    ELSE
      RETURN 'other';
  END CASE;`);
  });

  test("evaluates a computed discriminant once and fills an empty branch with NULL;", async () => {
    const result = await compileFixture("switchStatement.ts");
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
    const result = await compileFixture("interfaceShape.ts");
    expect(result.errors.map((e) => e.format())).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.composites.map((c) => c.sqlName)).toEqual(["todo_policy"]);
    expect(result.sql).toContain("CREATE TYPE app.todo_policy AS (");
    expect(result.sql).toContain("plan text");
    expect(result.sql).toContain("current_count double precision");
    expect(result.sql).toContain("policy app.todo_policy");
  });

  test("the composite is read with a parenthesised field reference", async () => {
    const result = await compileProject({ tsconfig: "examples/tsconfig.json", emit: { schema: "app" } });
    expect(result.sql).toContain("plan := (sub).plan;");
    expect(result.sql).toContain("sub app.subscription");
  });

  test("CREATE TYPE is guarded and checks the existing shape", async () => {
    const result = await compileFixture("interfaceShape.ts");
    expect(result.sql).toContain("IF to_regtype('app.todo_policy') IS NULL THEN");
    expect(result.sql).toContain("RAISE EXCEPTION");
  });

  test("types are emitted before the functions that use them", async () => {
    const result = await compileProject({ tsconfig: "examples/tsconfig.json", emit: { schema: "app" } });
    expect(result.sql.indexOf("CREATE TYPE app.subscription")).toBeLessThan(result.sql.indexOf("sub app.subscription"));
  });

  test("only types a compiled function uses are emitted", async () => {
    // `objectEquality.ts` fails to lower, so its type must not be left behind.
    const result = await compileFixture("objectEquality.ts");
    expect(result.ok).toBe(false);
    expect(result.composites).toEqual([]);
  });

  rejects([
    ["anonymousObject.ts", "Anonymous object types are not supported"],
    ["optionalProperty.ts", "`Account.note` is optional"],
    ["objectEquality.ts", "Objects compare by identity in TypeScript"],
    ["indexSignature.ts", "`Bag` has an index signature"],
    ["collisionTypes.ts", "already used by `PlanInfo`"],
  ]);
});

describe("nested object types", () => {
  test("an anonymous nested shape flattens to a prefixed column", async () => {
    // The inner shape needs no name of its own: only the column does.
    const result = await compileFixture("nestedAnonymous.ts");
    expect(result.errors.map((e) => e.format())).toEqual([]);
    expect(result.composites[0]!.fields).toEqual([
      { path: ["foo", "bar"], sqlName: "foo_bar", type: { kind: "scalar", sql: "text", nullable: false } },
    ]);
    expect(result.sql).toContain("foo_bar text");
    expect(result.sql).toContain("RETURN (nested).foo_bar;");
  });

  test("a named nested type flattens the same way", async () => {
    const result = await compileFixture("nestedObject.ts");
    expect(result.errors.map((e) => e.format())).toEqual([]);
    // One flat type, not one per level — and no app.inner.
    expect(result.composites.map((c) => c.sqlName)).toEqual(["outer"]);
    expect(result.composites[0]!.fields.map((f) => f.sqlName)).toEqual(["label", "inner_count"]);
    expect(result.sql).toContain("inner_count double precision");
    expect(result.sql).toContain("(outer).inner_count > 10");
  });

  test("the rules project flattens the nested shape", async () => {
    const result = await compileProject({ tsconfig: "examples/tsconfig.json", emit: { schema: "app" } });
    expect(result.sql).toContain("CREATE TYPE app.nested AS (");
    expect(result.sql).toContain("foo_bar text");
    // The rule rebuilds the shape with a spread rather than mutating it.
    expect(result.sql).toContain("_nested := ROW('some')::app.nested;");
    expect(result.sql).toContain("RETURN _nested;");
  });

  test("mutating a field explains the by-value divergence, not `const`", async () => {
    // The same assignment is legal PL/pgSQL, but on a copy: TypeScript's
    // mutation is visible to the caller and SQL's is not.
    const result = await compileFixture("mutateField.ts");
    const error = result.errors[0]!;
    expect(error.message).toContain("mutates the caller's object in TypeScript");
    expect(error.message).toContain("passes a composite by value");
    expect(error.message).not.toContain("computes values with `const`");
    // And it names the construct that replaces it.
    expect(error.message).toContain("{ ...nested, field: x }");
    expect(error.format()).toContain('nested.foo.bar = "some";');
  });

  rejects([
    ["mutateField.ts", "the caller would never see the change"],
    // A group of columns cannot be referenced as a value once flattened.
    ["partialPath.ts", "`outer.foo` is a nested shape, not a value. Reference a leaf instead: `outer.foo.bar`"],
    ["nullableNested.ts", "is an object that may be absent"],
    ["recursiveShape.ts", "makes the shape recursive"],
    ["deepNesting.ts", "nests more than 4 levels deep"],
    // `{ foo: { bar } }` and `{ fooBar }` would both want the column foo_bar.
    ["flattenCollision.ts", "both flatten to the column `foo_bar`"],
    // PostgreSQL truncates past 63 bytes silently, which could collide.
    ["longFieldName.ts", "longer than PostgreSQL's 63-byte identifier limit"],
  ]);
});

describe("object literals and spread", () => {
  test("a spread rebuild compiles where mutation does not", async () => {
    const result = await compileFixture("spreadUpdate.ts");
    expect(result.errors.map((e) => e.format())).toEqual([]);
    // The nested spread supplies foo_bar, then `bar: "some"` overrides it.
    expect(result.sql).toContain("next := ROW('some')::app.mutable;");
    expect(result.sql).toContain("RETURN (next).foo_bar;");
  });

  test("a function can return a composite built from a spread", async () => {
    const result = await compileFixture("spreadReturn.ts");
    expect(result.errors.map((e) => e.format())).toEqual([]);
    expect(result.sql).toContain("RETURNS app.seat");
    // One ROW argument per flattened field, in field order.
    expect(result.sql).toContain("RETURN ROW((seat).plan, (seat).count + 1)::app.seat;");
  });

  test("a field can be read off a call that returns a composite", async () => {
    const result = await compileFixture("spreadReturn.ts");
    expect(result.sql).toContain("RETURN (app.grant_seat(seat)).count;");
  });

  test("a composite can be returned unchanged", async () => {
    const result = await compileFixture("compositeReturn.ts");
    expect(result.errors.map((e) => e.format())).toEqual([]);
    expect(result.sql).toContain("RETURNS app.plan");
    expect(result.sql).toContain("RETURN plan;");
  });

  test("the composite type a return value needs is emitted", async () => {
    const result = await compileFixture("spreadReturn.ts");
    expect(result.composites.map((c) => c.sqlName)).toEqual(["seat"]);
  });

  test("a nested group can be passed by spreading it into a literal", async () => {
    // `barOf(outer.foo)` is still rejected — the group has no column — but
    // `barOf({ ...outer.foo })` rebuilds it, which does.
    const result = await compileFixture("groupSpread.ts");
    expect(result.errors.map((e) => e.format())).toEqual([]);
    expect(result.sql).toContain("RETURN app.bar_of(ROW((outer).foo_bar)::app.inner);");
  });

  rejects([
    // ROW() has to be cast to a named type, so the literal needs a target.
    ["unannotatedLiteral.ts", "needs a named target type"],
  ]);
});

describe("rejections — runtime references", () => {
  rejects([
    ["asyncFn.ts", "`async` and `await` are not supported"],
    ["externalCall.ts", "`Math.max` is a JavaScript runtime global"],
    ["mathProperty.ts", "`Math.PI` is a JavaScript runtime global"],
    ["jsonGlobal.ts", "`JSON.stringify` is a JavaScript runtime global"],
    ["dateGlobal.ts", "`Date` is a JavaScript runtime global"],
    ["infinityGlobal.ts", "`Infinity` is outside the supported subset"],
    ["packageImport.ts", "comes from a package (`fast-check`)"],
    ["paramProperty.ts", "object and element access are not part of the compiled subset"],
    ["methodCall.ts", "methods on values are not part of the compiled subset"],
  ]);

  test("globals are detected by provenance, not by name", async () => {
    // A parameter called `Math` is a parameter, and compiles.
    const result = await compileFixture("shadowedGlobal.ts");
    expect(result.errors.map((e) => e.format())).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.sql).toContain("math double precision");
    expect(result.sql).toContain("RETURN math + 1;");
  });

  test("a runtime global is reported where it is written", async () => {
    const result = await compileFixture("mathProperty.ts");
    const error = result.errors[0]!;
    expect(error.line).toBe(2);
    expect(error.format()).toContain("return n > Math.PI;");
  });
});
