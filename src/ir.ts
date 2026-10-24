/**
 * The compiler's intermediate representation.
 *
 * Lowering (TypeScript AST -> IR) is where every restriction is enforced, so
 * the emitter can be a total function: any IR that exists is emittable.
 */

export type PgScalar = "text" | "integer" | "numeric" | "double precision" | "boolean";

export interface ScalarType {
  readonly kind: "scalar";
  readonly sql: PgScalar;
  readonly nullable: boolean;
  /** Allowed values, when the TypeScript side was a union of string literals. */
  readonly allowed?: readonly string[];
}

/**
 * A named TypeScript object type, mapped to a PostgreSQL composite type.
 *
 * TypeScript object types are structural and PostgreSQL composites are nominal,
 * so the mapping is keyed to the *name* the author wrote: one `CREATE TYPE` per
 * named interface or type alias. Anonymous shapes are rejected, since there
 * would be no name to generate.
 */
export interface CompositeType {
  readonly kind: "composite";
  readonly tsName: string;
  readonly sqlName: string;
  readonly fields: readonly CompositeField[];
  readonly nullable: boolean;
  /** Source module, for the provenance comment on the generated type. */
  readonly module?: string;
}

/**
 * One leaf of a (possibly nested) object shape.
 *
 * Nested shapes are flattened: `{ foo: { bar: string } }` yields a single field
 * with path `["foo", "bar"]` and SQL name `foo_bar`. Flattening keeps the
 * composite one level deep, which matters because an intermediate composite can
 * be NULL in SQL even where TypeScript guarantees a value — with no intermediate
 * there is nothing to be NULL.
 */
export interface CompositeField {
  /** The TypeScript access path from the object root, e.g. `["foo", "bar"]`. */
  readonly path: readonly string[];
  readonly sqlName: string;
  /** A scalar, or an array: an array is a leaf, one column of array type. */
  readonly type: ScalarType | ArrayType;
}

/** How a field path reads in a message: `foo.bar`. */
export function fieldLabel(path: readonly string[]): string {
  return path.join(".");
}

/**
 * A `readonly T[]` parameter, local or object field, mapped to a PostgreSQL
 * array of the element type.
 *
 * Only read-only arrays exist: PL/pgSQL passes an array by value, so a `push`
 * in TypeScript would change the caller's array while the SQL changed a copy.
 * Requiring `readonly` lets TypeScript refuse the mutation itself. An array is
 * never nullable, and its elements are a scalar (possibly nullable) or a
 * non-nullable composite.
 */
export interface ArrayType {
  readonly kind: "array";
  readonly element: ScalarType | CompositeType;
  readonly nullable: false;
}

export type PgType = ScalarType | CompositeType | ArrayType;

export function scalarType(sql: PgScalar, nullable = false, allowed?: readonly string[]): ScalarType {
  return allowed ? { kind: "scalar", sql, nullable, allowed } : { kind: "scalar", sql, nullable };
}

export function compositeType(
  tsName: string,
  sqlName: string,
  fields: readonly CompositeField[],
  nullable = false,
  module?: string,
): CompositeType {
  return { kind: "composite", tsName, sqlName, fields, nullable, ...(module === undefined ? {} : { module }) };
}

export function isScalar(type: PgType): type is ScalarType {
  return type.kind === "scalar";
}

export function isComposite(type: PgType): type is CompositeType {
  return type.kind === "composite";
}

export function isArray(type: PgType): type is ArrayType {
  return type.kind === "array";
}

export function arrayType(element: ScalarType | CompositeType): ArrayType {
  return { kind: "array", element, nullable: false };
}

/** Is this exactly the given scalar type? Never true for a composite. */
export function isExactly(type: PgType, sql: PgScalar): boolean {
  return isScalar(type) && type.sql === sql;
}

const NUMERIC_SCALARS = new Set<PgScalar>(["integer", "numeric", "double precision"]);

export function isNumeric(type: PgType): boolean {
  return isScalar(type) && NUMERIC_SCALARS.has(type.sql);
}

/** How the type is named in an error message: the SQL type, or the TypeScript name. */
export function describe(type: PgType): string {
  if (isArray(type)) {
    const element = describe(type.element);
    return type.element.nullable ? `(${element} | null)[]` : `${element}[]`;
  }
  return isScalar(type) ? type.sql : type.tsName;
}

export function withNullable(type: PgType, nullable: boolean): PgType {
  if (type.nullable === nullable) return type;
  // An array is never nullable: the type mapping refuses `readonly T[] | null`.
  if (isArray(type)) return type;
  return isScalar(type)
    ? scalarType(type.sql, nullable, type.allowed)
    : compositeType(type.tsName, type.sqlName, type.fields, nullable, type.module);
}

/**
 * Can a value of `a` stand in for one of `b`, ignoring nullability?
 * Numeric scalars interchange because PostgreSQL widens them implicitly;
 * composites must be the same named type, since they are nominal in SQL.
 */
export function sameFamily(a: PgType, b: PgType): boolean {
  // Arrays interchange only when their elements are exactly the same type:
  // PostgreSQL would cast `integer[]` to `double precision[]`, but nothing in
  // the subset needs it, and an exact match leaves nothing to reason about.
  if (isArray(a) || isArray(b)) {
    return isArray(a) && isArray(b) && sameElement(a.element, b.element);
  }
  if (isComposite(a) || isComposite(b)) {
    return isComposite(a) && isComposite(b) && a.sqlName === b.sqlName;
  }
  return a.sql === b.sql || (isNumeric(a) && isNumeric(b));
}

function sameElement(a: ScalarType | CompositeType, b: ScalarType | CompositeType): boolean {
  if (isComposite(a) || isComposite(b)) return isComposite(a) && isComposite(b) && a.sqlName === b.sqlName;
  return a.sql === b.sql;
}

/** TypeScript computes all arithmetic in doubles; these ranks only widen. */
const NUMERIC_RANK: Record<string, number> = { integer: 1, numeric: 2, "double precision": 3 };

export function widenNumeric(a: PgScalar, b: PgScalar): PgScalar {
  return (NUMERIC_RANK[a] ?? 0) >= (NUMERIC_RANK[b] ?? 0) ? a : b;
}

/** The field list that identifies a composite's shape, for collision checks. */
export function shapeOf(composite: CompositeType): string {
  return composite.fields.map((f) => `${f.sqlName} ${columnType(f.type)}`).join(", ");
}

function columnType(type: ScalarType | ArrayType): string {
  if (!isArray(type)) return type.sql;
  return `${isScalar(type.element) ? type.element.sql : type.element.sqlName}[]`;
}

export interface ParamIR {
  readonly tsName: string;
  readonly sqlName: string;
  readonly type: PgType;
}

export interface LocalIR {
  readonly tsName: string;
  readonly sqlName: string;
  readonly type: PgType;
}

export interface FunctionIR {
  readonly tsName: string;
  readonly sqlName: string;
  /** Source module, relative to the project root — used by the parity harness. */
  readonly module: string;
  readonly params: readonly ParamIR[];
  readonly returns: PgType;
  readonly locals: readonly LocalIR[];
  readonly body: readonly StmtIR[];
}

export type StmtIR =
  | { readonly kind: "return"; readonly expr: ExprIR }
  | { readonly kind: "assign"; readonly sqlName: string; readonly expr: ExprIR }
  | {
      readonly kind: "if";
      readonly branches: readonly { readonly cond: ExprIR; readonly body: readonly StmtIR[] }[];
      readonly orElse?: readonly StmtIR[];
    }
  /** `CASE subject WHEN v1, v2 THEN … ELSE … END CASE`: matches with `=`. */
  | {
      readonly kind: "simpleCase";
      readonly subject: ExprIR;
      readonly whens: readonly { readonly values: readonly ExprIR[]; readonly body: readonly StmtIR[] }[];
      readonly orElse: readonly StmtIR[];
    }
  /** `CASE WHEN cond THEN … ELSE … END CASE`. */
  | {
      readonly kind: "searchedCase";
      readonly whens: readonly { readonly cond: ExprIR; readonly body: readonly StmtIR[] }[];
      readonly orElse: readonly StmtIR[];
    }
  /** `WHILE cond LOOP … END LOOP;` — every TypeScript loop lowers to this. */
  | { readonly kind: "while"; readonly cond: ExprIR; readonly body: readonly StmtIR[] }
  /**
   * `FOREACH variable IN ARRAY array LOOP … END LOOP;` — a `for (const x of xs)`.
   * The variable is a local of the element type.
   */
  | { readonly kind: "foreach"; readonly variable: string; readonly array: ExprIR; readonly body: readonly StmtIR[] }
  /**
   * `RAISE EXCEPTION '%', message;` — a `throw new Error(message)`. The message
   * is a parameter of the format, never the format itself, so a `%` in it is
   * written as is.
   */
  | { readonly kind: "raise"; readonly message: ExprIR }
  /** `EXIT;` — an unlabelled `break` out of the innermost loop. */
  | { readonly kind: "exit" }
  /** `CONTINUE;` — the next turn of the innermost loop. */
  | { readonly kind: "continue" };

export type BinOp =
  | "="
  | "<>"
  | "is not distinct from"
  | "is distinct from"
  | "<"
  | "<="
  | ">"
  | ">="
  | "+"
  | "-"
  | "*"
  | "/"
  | "%"
  | "and"
  | "or"
  | "||";

export type ExprIR =
  | { readonly kind: "ref"; readonly sqlName: string; readonly type: PgType }
  | { readonly kind: "field"; readonly operand: ExprIR; readonly sqlName: string; readonly type: PgType }
  | { readonly kind: "lit"; readonly value: string | number | boolean | null; readonly type: ScalarType }
  | {
      readonly kind: "binary";
      readonly op: BinOp;
      readonly left: ExprIR;
      readonly right: ExprIR;
      readonly type: ScalarType;
    }
  | { readonly kind: "not"; readonly operand: ExprIR; readonly type: ScalarType }
  | { readonly kind: "neg"; readonly operand: ExprIR; readonly type: ScalarType }
  | { readonly kind: "nullTest"; readonly operand: ExprIR; readonly negated: boolean; readonly type: ScalarType }
  | { readonly kind: "coalesce"; readonly left: ExprIR; readonly right: ExprIR; readonly type: PgType }
  | {
      readonly kind: "case";
      readonly cond: ExprIR;
      readonly whenTrue: ExprIR;
      readonly whenFalse: ExprIR;
      readonly type: PgType;
    }
  /**
   * `CASE subject WHEN v THEN r … ELSE e END`, the expression form. Unlike the
   * PL/pgSQL statement, SQL's expression takes one value per `WHEN`.
   */
  | {
      readonly kind: "simpleCaseExpr";
      readonly subject: ExprIR;
      readonly whens: readonly { readonly value: ExprIR; readonly result: ExprIR }[];
      readonly orElse: ExprIR;
      readonly type: PgType;
    }
  /** `CASE WHEN cond THEN r … ELSE e END`. */
  | {
      readonly kind: "searchedCaseExpr";
      readonly whens: readonly { readonly cond: ExprIR; readonly result: ExprIR }[];
      readonly orElse: ExprIR;
      readonly type: PgType;
    }
  | { readonly kind: "call"; readonly sqlName: string; readonly args: readonly ExprIR[]; readonly type: PgType }
  | { readonly kind: "cast"; readonly operand: ExprIR; readonly to: PgScalar; readonly type: ScalarType }
  /** `cardinality(array)` — `xs.length`. Not `array_length`, which is NULL for an empty array. */
  | { readonly kind: "arrayLength"; readonly operand: ExprIR; readonly type: ScalarType }
  /**
   * `array_position(array, value) IS NOT NULL` — `xs.includes(value)` on scalar
   * elements. `array_position` compares with `IS NOT DISTINCT FROM`, so a NULL
   * is found like any other value, as `includes` finds `null`.
   */
  | { readonly kind: "arrayIncludes"; readonly array: ExprIR; readonly value: ExprIR; readonly type: ScalarType }
  /**
   * `[a, b, ...xs, c]`: runs of elements become `ARRAY[a, b]::t[]`, spreads stay
   * arrays, and the parts are concatenated with `||`. No parts is `ARRAY[]::t[]`.
   */
  | { readonly kind: "arrayLiteral"; readonly parts: readonly ArrayPart[]; readonly type: ArrayType }
  /** `xs::double precision[]` — an array whose numeric elements widen, element by element. */
  | { readonly kind: "arrayCast"; readonly operand: ExprIR; readonly type: ArrayType }
  // `ROW(a, b)::app.thing` — one argument per flattened field, in field order.
  | { readonly kind: "row"; readonly args: readonly ExprIR[]; readonly type: CompositeType };

/** One run of an array literal: elements written out, or an array spread into it. */
export type ArrayPart =
  | { readonly kind: "items"; readonly items: readonly ExprIR[] }
  | { readonly kind: "spread"; readonly array: ExprIR };

/** Signature-only view of a function, used to check calls before bodies are lowered. */
export interface SignatureIR {
  readonly tsName: string;
  readonly sqlName: string;
  readonly params: readonly ParamIR[];
  readonly returns: PgType;
}
