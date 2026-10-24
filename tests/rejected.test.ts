import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { compileProject } from "../src/compile.ts";

/**
 * Rules the compiler must refuse, one file per case in tests/rejected/. Each is
 * valid TypeScript (its tsconfig keeps tsc happy), so what is exercised is the
 * translator's own refusal and its message.
 */

/** Compile a single case, so each test sees only its own errors. */
async function compileCase(file: string) {
  const target = resolve("tests/rejected", file);
  return compileProject({
    tsconfig: "tests/rejected/tsconfig.json",
    include: (fileName) => resolve(fileName) === target,
    emit: { schema: "app" },
  });
}

function rejects(cases: [file: string, expected: string][]) {
  for (const [file, expected] of cases) {
    test(`${file} is rejected at build time`, async () => {
      const result = await compileCase(file);
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
    const result = await compileCase("truthiness.ts");
    const error = result.errors[0]!;
    expect(error.fileName).toEndWith("tests/rejected/truthiness.ts");
    expect(error.line).toBe(2);
    expect(error.format()).toContain("if (name) {");
  });
});

describe("rejections — object types", () => {
  test("only types a compiled function uses are emitted", async () => {
    // `objectEquality.ts` fails to lower, so its type must not be left behind.
    const result = await compileCase("objectEquality.ts");
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

describe("rejections — nested object types", () => {
  test("mutating a field explains the by-value divergence, not `const`", async () => {
    // The same assignment is legal PL/pgSQL, but on a copy: TypeScript's
    // mutation is visible to the caller and SQL's is not.
    const result = await compileCase("mutateField.ts");
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

describe("rejections — object literals", () => {
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

  test("a runtime global is reported where it is written", async () => {
    const result = await compileCase("mathProperty.ts");
    const error = result.errors[0]!;
    expect(error.line).toBe(2);
    expect(error.format()).toContain("return n > Math.PI;");
  });
});
