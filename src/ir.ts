/**
 * The compiler's intermediate representation.
 *
 * Lowering (TypeScript AST -> IR) is where every restriction is enforced, so
 * the emitter can be a total function: any IR that exists is emittable.
 */

export type PgScalar = "text" | "integer" | "double precision" | "boolean";

/** The names of the scalar types: written here, and read as `PG.integer` everywhere else. */
export const PG = {
  text: "text",
  integer: "integer",
  double: "double precision",
  boolean: "boolean",
} as const satisfies Record<string, PgScalar>;

/** The `kind` of every IR node, written here and read as `EXPR.binary`, `STMT.return`… everywhere else. */
export const TYPE = {
  scalar: "scalar",
  composite: "composite",
  array: "array",
} as const;

export const NAMED = {
  domain: "domain",
  enum: "enum",
} as const;

export const STMT = {
  return: "return",
  assign: "assign",
  if: "if",
  simpleCase: "simpleCase",
  searchedCase: "searchedCase",
  while: "while",
  foreach: "foreach",
  exit: "exit",
  continue: "continue",
} as const;

export const EXPR = {
  ref: "ref",
  field: "field",
  lit: "lit",
  binary: "binary",
  not: "not",
  neg: "neg",
  nullTest: "nullTest",
  coalesce: "coalesce",
  case: "case",
  simpleCaseExpr: "simpleCaseExpr",
  searchedCaseExpr: "searchedCaseExpr",
  call: "call",
  builtin: "builtin",
  cast: "cast",
  helper: "helper",
  arrayLength: "arrayLength",
  arrayIncludes: "arrayIncludes",
  arrayLiteral: "arrayLiteral",
  arrayCast: "arrayCast",
  row: "row",
} as const;

export const PART = {
  items: "items",
  spread: "spread",
} as const;

export interface ScalarType {
  readonly kind: typeof TYPE.scalar;
  readonly sql: PgScalar;
  readonly nullable: boolean;
  /** Allowed values, when the TypeScript side was a union of string literals. */
  readonly allowed?: readonly string[];
  /**
   * The named PostgreSQL type a closed set of strings maps to. `sql` stays
   * `text`: a domain is text with a CHECK, and an enum is compared, matched and
   * written like text once lowering has inserted the `::text` casts it needs.
   */
  readonly named?: NamedText;
}

/**
 * A named, closed set of strings, created as its own PostgreSQL type.
 *
 * - `type Plan = "free" | "pro"` is a **domain** over `text` with a CHECK: a
 *   TypeScript union is structural — any matching string literal is one — and a
 *   domain is too: any text that passes the CHECK is one, with no cast.
 * - `const AreaType = { … } as const` with `type AreaType = (typeof AreaType)[keyof
 *   typeof AreaType]`, or a string `enum`, is a PostgreSQL **enum**: a named
 *   vocabulary, which PostGraphile exposes as a GraphQL enum and PostgREST
 *   orders by declaration.
 */
export interface NamedText {
  readonly kind: typeof NAMED.domain | "enum";
  readonly tsName: string;
  readonly sqlName: string;
  /** In declaration order for an enum (its order is part of the type); sorted for a domain. */
  readonly values: readonly string[];
  /** Source module, for the provenance comment. */
  readonly module?: string;
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
  readonly kind: typeof TYPE.composite;
  readonly tsName: string;
  readonly sqlName: string;
  readonly fields: readonly CompositeField[];
  readonly nullable: boolean;
  /** Source module, for the provenance comment on the generated type. */
  readonly module?: string;
}

/**
 * One field of an object shape, one column of the composite type.
 *
 * A field of an object type is a column of that type's own composite, as
 * PostgreSQL nests them: `customer: Customer` is `customer app.customer`, read
 * as `((basket).customer).tier`. Its type is never nullable — `IS NULL` on a
 * composite is also true for a row whose fields are all NULL, so a nullable
 * one would have two absences SQL cannot tell apart.
 */
export interface CompositeField {
  readonly tsName: string;
  readonly sqlName: string;
  readonly type: ScalarType | ArrayType | CompositeType;
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
  readonly kind: typeof TYPE.array;
  readonly element: ScalarType | CompositeType;
  readonly nullable: false;
}

export type PgType = ScalarType | CompositeType | ArrayType;

export function scalarType(
  sql: PgScalar,
  nullable = false,
  allowed?: readonly string[],
  named?: NamedText,
): ScalarType {
  return {
    kind: TYPE.scalar,
    sql,
    nullable,
    ...(allowed ? { allowed } : {}),
    ...(named ? { named } : {}),
  };
}

/** The plain, non-nullable scalar types, shared: a `ScalarType` is never mutated. */
export const TEXT = scalarType(PG.text);
export const INTEGER = scalarType(PG.integer);
export const DOUBLE = scalarType(PG.double);
export const BOOLEAN = scalarType(PG.boolean);

/** The named type a closed set of strings maps to: `text` and a domain or an enum. */
export function namedType(named: NamedText, nullable = false): ScalarType {
  return scalarType(PG.text, nullable, named.values, named);
}

/** An enum value needs `::text` wherever text is expected; a domain is text already. */
export function isEnum(type: PgType): boolean {
  return isScalar(type) && type.named?.kind === NAMED.enum;
}

/** Do two types name the same domain or enum (or are both plain)? */
export function sameNamed(a: PgType, b: PgType): boolean {
  const left = isScalar(a) ? a.named?.sqlName : undefined;
  const right = isScalar(b) ? b.named?.sqlName : undefined;
  return left === right;
}

export function compositeType(
  tsName: string,
  sqlName: string,
  fields: readonly CompositeField[],
  nullable = false,
  module?: string,
): CompositeType {
  return { kind: TYPE.composite, tsName, sqlName, fields, nullable, ...(module === undefined ? {} : { module }) };
}

export function isScalar(type: PgType): type is ScalarType {
  return type.kind === TYPE.scalar;
}

export function isComposite(type: PgType): type is CompositeType {
  return type.kind === TYPE.composite;
}

export function isArray(type: PgType): type is ArrayType {
  return type.kind === TYPE.array;
}

export function arrayType(element: ScalarType | CompositeType): ArrayType {
  return { kind: TYPE.array, element, nullable: false };
}

/** Is this exactly the given scalar type? Never true for a composite. */
export function isExactly(type: PgType, sql: PgScalar): boolean {
  return isScalar(type) && type.sql === sql;
}

const NUMERIC_SCALARS = new Set<PgScalar>([PG.integer, PG.double]);

export function isNumeric(type: PgType): boolean {
  return isScalar(type) && NUMERIC_SCALARS.has(type.sql);
}

/** How the type is named in an error message: the SQL type, or the TypeScript name. */
export function describe(type: PgType): string {
  if (isScalar(type) && type.named) return type.named.tsName;
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
    ? scalarType(type.sql, nullable, type.allowed, type.named)
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
const NUMERIC_RANK: Record<string, number> = { [PG.integer]: 1, [PG.double]: 2 };

export function widenNumeric(a: PgScalar, b: PgScalar): PgScalar {
  return (NUMERIC_RANK[a] ?? 0) >= (NUMERIC_RANK[b] ?? 0) ? a : b;
}

/** The field list that identifies a composite's shape, for collision checks. */
export function shapeOf(composite: CompositeType): string {
  return composite.fields.map((f) => `${f.sqlName} ${columnType(f.type)}`).join(", ");
}

function columnType(type: PgType): string {
  if (isArray(type)) return `${columnType(type.element)}[]`;
  return isScalar(type) ? (type.named?.sqlName ?? type.sql) : type.sqlName;
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
  /** The helpers of `src/helpers.ts` this function calls: the migration installs them first. */
  readonly helpers: readonly string[];
  /** The compiled functions this one calls (SQL names), sorted. */
  readonly calls: readonly string[];
  /**
   * `sql` when the body is one `return` of an expression: PostgreSQL then inlines the call into the
   * query that makes it, where a PL/pgSQL function stays opaque to the planner (no index, one call per
   * row). Chosen by `src/language.ts`, once every function has been lowered.
   */
  readonly language: "sql" | "plpgsql";
}

export type StmtIR =
  | { readonly kind: typeof STMT.return; readonly expr: ExprIR }
  | { readonly kind: typeof STMT.assign; readonly sqlName: string; readonly expr: ExprIR }
  | {
      readonly kind: typeof STMT.if;
      readonly branches: readonly { readonly cond: ExprIR; readonly body: readonly StmtIR[] }[];
      readonly orElse?: readonly StmtIR[];
    }
  /** `CASE subject WHEN v1, v2 THEN … ELSE … END CASE`: matches with `=`. */
  | {
      readonly kind: typeof STMT.simpleCase;
      readonly subject: ExprIR;
      readonly whens: readonly { readonly values: readonly ExprIR[]; readonly body: readonly StmtIR[] }[];
      readonly orElse: readonly StmtIR[];
    }
  /** `CASE WHEN cond THEN … ELSE … END CASE`. */
  | {
      readonly kind: typeof STMT.searchedCase;
      readonly whens: readonly { readonly cond: ExprIR; readonly body: readonly StmtIR[] }[];
      readonly orElse: readonly StmtIR[];
    }
  /** `WHILE cond LOOP … END LOOP;` — every TypeScript loop lowers to this. */
  | { readonly kind: typeof STMT.while; readonly cond: ExprIR; readonly body: readonly StmtIR[] }
  /**
   * `FOREACH variable IN ARRAY array LOOP … END LOOP;` — a `for (const x of xs)`.
   * The variable is a local of the element type.
   */
  | {
      readonly kind: typeof STMT.foreach;
      readonly variable: string;
      readonly array: ExprIR;
      readonly body: readonly StmtIR[];
    }
  /** `EXIT;` — an unlabelled `break` out of the innermost loop. */
  | { readonly kind: typeof STMT.exit }
  /** `CONTINUE;` — the next turn of the innermost loop. */
  | { readonly kind: typeof STMT.continue };

/** The binary operators of the IR, as the SQL that spells them. */
export const OP = {
  eq: "=",
  ne: "<>",
  isNotDistinct: "is not distinct from",
  isDistinct: "is distinct from",
  lt: "<",
  le: "<=",
  gt: ">",
  ge: ">=",
  add: "+",
  sub: "-",
  mul: "*",
  div: "/",
  mod: "%",
  and: "and",
  or: "or",
  concat: "||",
} as const;

export type BinOp = (typeof OP)[keyof typeof OP];

export type ExprIR =
  | { readonly kind: typeof EXPR.ref; readonly sqlName: string; readonly type: PgType }
  | { readonly kind: typeof EXPR.field; readonly operand: ExprIR; readonly sqlName: string; readonly type: PgType }
  | { readonly kind: typeof EXPR.lit; readonly value: string | number | boolean | null; readonly type: ScalarType }
  | {
      readonly kind: typeof EXPR.binary;
      readonly op: BinOp;
      readonly left: ExprIR;
      readonly right: ExprIR;
      readonly type: ScalarType;
    }
  | { readonly kind: typeof EXPR.not; readonly operand: ExprIR; readonly type: ScalarType }
  | { readonly kind: typeof EXPR.neg; readonly operand: ExprIR; readonly type: ScalarType }
  | {
      readonly kind: typeof EXPR.nullTest;
      readonly operand: ExprIR;
      readonly negated: boolean;
      readonly type: ScalarType;
    }
  | { readonly kind: typeof EXPR.coalesce; readonly left: ExprIR; readonly right: ExprIR; readonly type: PgType }
  | {
      readonly kind: typeof EXPR.case;
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
      readonly kind: typeof EXPR.simpleCaseExpr;
      readonly subject: ExprIR;
      readonly whens: readonly { readonly value: ExprIR; readonly result: ExprIR }[];
      readonly orElse: ExprIR;
      readonly type: PgType;
    }
  /** `CASE WHEN cond THEN r … ELSE e END`. */
  | {
      readonly kind: typeof EXPR.searchedCaseExpr;
      readonly whens: readonly { readonly cond: ExprIR; readonly result: ExprIR }[];
      readonly orElse: ExprIR;
      readonly type: PgType;
    }
  | {
      readonly kind: typeof EXPR.call;
      readonly sqlName: string;
      readonly args: readonly ExprIR[];
      readonly type: PgType;
    }
  /**
   * A PostgreSQL built-in, called by its bare name — `Math.floor(x)` is
   * `floor(x)`. Unlike `call` it is not one of the compiled functions, so it is
   * never schema-qualified. Lowering has already widened every argument, so the
   * emitter prints it as written.
   */
  | {
      readonly kind: typeof EXPR.builtin;
      readonly sql: string;
      readonly args: readonly ExprIR[];
      readonly type: ScalarType;
    }
  | { readonly kind: typeof EXPR.cast; readonly operand: ExprIR; readonly to: PgScalar; readonly type: ScalarType }
  /**
   * A call to one of the functions tsql installs in its own schema
   * (`tsql.math_round(x)`, `src/helpers.ts`). Like `builtin` it is not one of the
   * compiled functions, but the migration has to install it, so lowering records
   * the names it used in `FunctionIR.helpers`.
   */
  | {
      readonly kind: typeof EXPR.helper;
      readonly name: string;
      readonly args: readonly ExprIR[];
      readonly type: ScalarType;
    }
  /** `cardinality(array)` — `xs.length`. Not `array_length`, which is NULL for an empty array. */
  | { readonly kind: typeof EXPR.arrayLength; readonly operand: ExprIR; readonly type: ScalarType }
  /**
   * `array_position(array, value) IS NOT NULL` — `xs.includes(value)` on scalar
   * elements. `array_position` compares with `IS NOT DISTINCT FROM`, so a NULL
   * is found like any other value, as `includes` finds `null`.
   */
  | {
      readonly kind: typeof EXPR.arrayIncludes;
      readonly array: ExprIR;
      readonly value: ExprIR;
      readonly type: ScalarType;
    }
  /**
   * `[a, b, ...xs, c]`: runs of elements become `ARRAY[a, b]::t[]`, spreads stay
   * arrays, and the parts are concatenated with `||`. No parts is `ARRAY[]::t[]`.
   */
  | { readonly kind: typeof EXPR.arrayLiteral; readonly parts: readonly ArrayPart[]; readonly type: ArrayType }
  /** `xs::double precision[]` — an array whose numeric elements widen, element by element. */
  | { readonly kind: typeof EXPR.arrayCast; readonly operand: ExprIR; readonly type: ArrayType }
  // `ROW(a, b)::app.thing` — one argument per field, in field order; a field of an object type is a `ROW` too.
  | { readonly kind: typeof EXPR.row; readonly args: readonly ExprIR[]; readonly type: CompositeType };

/** One run of an array literal: elements written out, or an array spread into it. */
export type ArrayPart =
  | { readonly kind: typeof PART.items; readonly items: readonly ExprIR[] }
  | { readonly kind: typeof PART.spread; readonly array: ExprIR };

/** Signature-only view of a function, used to check calls before bodies are lowered. */
export interface SignatureIR {
  readonly tsName: string;
  readonly sqlName: string;
  readonly params: readonly ParamIR[];
  readonly returns: PgType;
}

/**
 * Whether `test` holds for an expression or any expression inside it. Exhaustive on purpose: a new kind
 * of expression will not compile until it says where its operands are.
 */
export function someExpr(expr: ExprIR, test: (expr: ExprIR) => boolean): boolean {
  if (test(expr)) return true;
  const any = (children: readonly ExprIR[]) => children.some((child) => someExpr(child, test));
  switch (expr.kind) {
    case EXPR.ref:
    case EXPR.lit:
      return false;
    case EXPR.field:
    case EXPR.not:
    case EXPR.neg:
    case EXPR.nullTest:
    case EXPR.cast:
    case EXPR.arrayLength:
    case EXPR.arrayCast:
      return any([expr.operand]);
    case EXPR.binary:
    case EXPR.coalesce:
      return any([expr.left, expr.right]);
    case EXPR.case:
      return any([expr.cond, expr.whenTrue, expr.whenFalse]);
    case EXPR.simpleCaseExpr:
      return any([expr.subject, ...expr.whens.flatMap((w) => [w.value, w.result]), expr.orElse]);
    case EXPR.searchedCaseExpr:
      return any([...expr.whens.flatMap((w) => [w.cond, w.result]), expr.orElse]);
    case EXPR.call:
    case EXPR.builtin:
    case EXPR.helper:
    case EXPR.row:
      return any(expr.args);
    case EXPR.arrayIncludes:
      return any([expr.array, expr.value]);
    case EXPR.arrayLiteral:
      return any(expr.parts.flatMap((part) => (part.kind === PART.items ? part.items : [part.array])));
  }
}

/**
 * Can a value of `from` be stored where `to` is expected? Numbers may only
 * widen (`integer` → `numeric` → `double precision`). Narrowing is refused:
 * TypeScript keeps the double it computed, while PostgreSQL would silently
 * round it on assignment — `return x` with `x = 2.5` into `RETURNS integer`
 * gives 2.5 in one language and 2 in the other.
 */
export function assignable(from: PgType, to: PgType): boolean {
  if (from.nullable && !to.nullable) return false;
  if (isArray(from) || isArray(to)) {
    if (!isArray(from) || !isArray(to)) return false;
    // An array of nullable elements cannot stand in for one whose elements are not.
    if (from.element.nullable && !to.element.nullable) return false;
    // Numeric elements widen as numbers do, by an array cast.
    const [a, b] = [from.element, to.element];
    if (isScalar(a) && isScalar(b) && isNumeric(a) && isNumeric(b)) return widenNumeric(a.sql, b.sql) === b.sql;
    return sameFamily(from, to);
  }
  if (isNumeric(from) && isNumeric(to) && isScalar(from) && isScalar(to)) {
    return widenNumeric(from.sql, to.sql) === to.sql;
  }
  return sameFamily(from, to);
}
