/**
 * Strict equality: the operator it becomes, and what `NaN` does to it.
 */
import { type Node } from "typescript/unstable/ast";
import { CompileError } from "../../errors.ts";
import { isArray, isComposite, isEnum, isExactly, sameNamed, scalarType, type BinOp, type ExprIR } from "../../ir.ts";
import { requireComparable, textOf } from "../coerce.ts";

/** The checks `===` / `!==` make on its operands; a `switch` label makes the same ones. */
export function checkStrictEquality(left: ExprIR, right: ExprIR, at: Node): void {
  if (isArray(left.type) || isArray(right.type)) {
    throw CompileError.at(
      at,
      "Arrays compare by identity in TypeScript and by value in SQL, so `===` on an array has no faithful translation.",
    );
  }
  if (isComposite(left.type) || isComposite(right.type)) {
    throw CompileError.at(
      at,
      "Objects compare by identity in TypeScript and by value in SQL, so `===` on an object has no faithful translation. Compare the fields you care about.",
    );
  }
  requireComparable(left.type, right.type, at);
}

/**
 * Two operands made comparable in SQL. An enum is a type of its own: equal to
 * itself or to a literal, which takes its type, but compared as `text` with
 * anything else — a plain string, a domain, another enum. TypeScript compares
 * the strings either way, so comparing the text is the faithful translation.
 */
function comparable(left: ExprIR, right: ExprIR): [ExprIR, ExprIR] {
  // A plain string literal is untyped in SQL, so it takes the other side's type.
  const untyped = (e: ExprIR) => e.kind === "lit" && !isEnum(e.type);
  if (sameNamed(left.type, right.type) || untyped(left) || untyped(right)) return [left, right];
  return [textOf(left), textOf(right)];
}

/** `===` / `!==` between two lowered operands; also how a searched `switch` label matches. */
export function strictEquality(leftOperand: ExprIR, rightOperand: ExprIR, negated: boolean, at: Node): ExprIR {
  checkStrictEquality(leftOperand, rightOperand, at);
  const [left, right] = comparable(leftOperand, rightOperand);
  // TypeScript's equality is total; SQL's `=` is three-valued. When either
  // side can be null, `IS [NOT] DISTINCT FROM` is the faithful translation.
  const nullable = left.type.nullable || right.type.nullable;
  const binOp: BinOp = nullable ? (negated ? "is distinct from" : "is not distinct from") : negated ? "<>" : "=";
  const core: ExprIR = { kind: "binary", op: binOp, left, right, type: scalarType("boolean") };
  // PostgreSQL's `NaN` equals itself; JavaScript's never equals anything. When the left side is equal to
  // the right and is not `NaN`, the right is not either, so one side decides.
  if (!canBeNaN(left)) return core;
  const isNaN: ExprIR = {
    kind: "binary",
    op: nullable ? "is not distinct from" : "=",
    left,
    right: NAN,
    type: scalarType("boolean"),
  };
  if (negated) return { kind: "binary", op: "or", left: core, right: isNaN, type: scalarType("boolean") };
  const notNaN: ExprIR = { ...isNaN, op: nullable ? "is distinct from" : "<>" };
  return { kind: "binary", op: "and", left: core, right: notNaN, type: scalarType("boolean") };
}

export const NAN: ExprIR = { kind: "lit", value: Number.NaN, type: scalarType("double precision") };

/**
 * Whether an operand can hold `NaN`: a `Float` that is not a literal (a literal is never `NaN`: `NaN` is
 * refused as a name) and not an `Integer` made into one.
 */
export function canBeNaN(expr: ExprIR): boolean {
  if (!isExactly(expr.type, "double precision")) return false;
  if (expr.kind === "lit") return false;
  return !(expr.kind === "cast" && !isExactly(expr.operand.type, "double precision"));
}
