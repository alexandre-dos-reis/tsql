/**
 * Type rules on the IR: what may be stored where, what may be compared, and the casts that make it so.
 */
import { type Node } from "typescript/unstable/ast";
import { CompileError } from "../errors.ts";
import {
  assignable,
  describe,
  isArray,
  isEnum,
  isNumeric,
  isScalar,
  namedType,
  sameFamily,
  sameNamed,
  scalarType,
  widenNumeric,
  withNullable,
  type ExprIR,
  type PgScalar,
  type PgType,
} from "../ir.ts";

/** An enum value as `text`; anything else as it is (a domain is text already). */
export function textOf(expr: ExprIR): ExprIR {
  if (!isEnum(expr.type)) return expr;
  const type = scalarType("text", expr.type.nullable);
  return expr.kind === "lit" ? { ...expr, type } : { kind: "cast", operand: expr, to: "text", type };
}

export function requireAssignable(from: PgType, to: PgType, at: Node, what: string): void {
  if (assignable(from, to)) return;
  if (from.nullable && !to.nullable) {
    throw CompileError.at(at, `The ${what} may be null; declare the type as \`T | null\` to allow it.`);
  }
  if (isNumeric(from) && isNumeric(to)) {
    throw CompileError.at(
      at,
      `The ${what} is \`${describe(from)}\` but \`${describe(to)}\` was expected. PostgreSQL would round it silently where TypeScript keeps the fraction; declare the wider type, or make the value whole explicitly.`,
    );
  }
  throw CompileError.at(at, `The ${what} is \`${describe(from)}\` but \`${describe(to)}\` was expected.`);
}

export function requireComparable(a: PgType, b: PgType, at: Node): void {
  if (!sameFamily(a, b)) {
    throw CompileError.at(at, `Cannot compare \`${describe(a)}\` with \`${describe(b)}\`.`);
  }
}

export function unify(a: PgType, b: PgType, at: Node, what: string): PgType {
  if (!sameFamily(a, b)) {
    throw CompileError.at(at, `The ${what} have incompatible types \`${describe(a)}\` and \`${describe(b)}\`.`);
  }
  if (!isScalar(a) || !isScalar(b)) return withNullable(a, a.nullable || b.nullable);

  const scalar: PgScalar = isNumeric(a) && isNumeric(b) ? widenNumeric(a.sql, b.sql) : a.sql;
  // Two of the same domain or enum stay that type; anything else meets as plain text.
  if (a.named && sameNamed(a, b)) return namedType(a.named, a.nullable || b.nullable);
  const allowed = a.allowed && b.allowed ? [...new Set([...a.allowed, ...b.allowed])] : undefined;
  return scalarType(scalar, a.nullable || b.nullable, allowed);
}

/** Widening casts are explicit in the IR so the emitter never has to guess. */
export function coerce(expr: ExprIR, to: PgType): ExprIR {
  if (isArray(expr.type) && isArray(to)) {
    const [from, into] = [expr.type.element, to.element];
    if (!isScalar(from) || !isScalar(into) || (from.sql === into.sql && sameNamed(from, into))) return expr;
    // `[]` and `[1, 2]` were already built with the target's element type; a
    // literal reaching here can be retyped rather than cast.
    if (expr.kind === "arrayLiteral" && expr.parts.length === 0) return { ...expr, type: to };
    return { kind: "arrayCast", operand: expr, type: to };
  }
  if (!isScalar(expr.type) || !isScalar(to)) return expr;
  // Text into a domain or an enum, or out of one. TypeScript has already proven
  // the value is one of the set when the target names one, so the cast cannot
  // fail; an enum leaving for plain text is cast to text, which always succeeds.
  if (expr.type.sql === "text" && to.sql === "text" && !sameNamed(expr.type, to)) {
    const target = scalarType("text", expr.type.nullable, to.allowed, to.named);
    // An untyped literal takes the type of wherever it is put.
    if (expr.kind === "lit") return { ...expr, type: target };
    if (to.named) return { kind: "cast", operand: textOf(expr), to: "text", type: target };
    return textOf(expr);
  }
  if (expr.type.sql === to.sql) return expr;
  if (!isNumeric(expr.type) || !isNumeric(to)) return expr;
  // A whole-number literal needs no cast: PostgreSQL widens `integer` on its own.
  if (expr.kind === "lit" && typeof expr.value === "number" && Number.isInteger(expr.value)) {
    return { ...expr, type: scalarType(to.sql, false, to.allowed) };
  }
  return { kind: "cast", operand: expr, to: to.sql, type: scalarType(to.sql, expr.type.nullable) };
}
