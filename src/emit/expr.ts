/**
 * Expressions, with the minimum of parentheses: PostgreSQL's operator precedence is the one thing the emitter works out for itself.
 */
import { isInt4 } from "@/constants";
import { TSQL_SCHEMA } from "@/helpers";
import { type BinOp, type ExprIR, PG, NAMED, EXPR, PART, OP } from "@/ir";
import { quoteIdentifier, quoteLiteral, quoteUnicodeLiteral } from "@/names";

import { arrayTypeName, type Qualifier } from "./qualify";

/**
 * PostgreSQL operator precedence, lowest first. Used to emit the minimum number
 * of parentheses rather than fully parenthesising every subexpression.
 */
const PREC = {
  or: 1,
  and: 2,
  not: 3,
  is: 4,
  comparison: 5,
  concat: 6,
  additive: 7,
  multiplicative: 8,
  unary: 9,
  atom: 10,
} as const;

const BINARY_PRECEDENCE: Record<BinOp, number> = {
  or: PREC.or,
  and: PREC.and,
  [OP.isDistinct]: PREC.is,
  [OP.isNotDistinct]: PREC.is,
  [OP.eq]: PREC.comparison,
  [OP.ne]: PREC.comparison,
  [OP.lt]: PREC.comparison,
  [OP.le]: PREC.comparison,
  [OP.gt]: PREC.comparison,
  [OP.ge]: PREC.comparison,
  [OP.concat]: PREC.concat,
  [OP.add]: PREC.additive,
  [OP.sub]: PREC.additive,
  [OP.mul]: PREC.multiplicative,
  [OP.div]: PREC.multiplicative,
  [OP.mod]: PREC.multiplicative,
};

function precedenceOf(expr: ExprIR): number {
  switch (expr.kind) {
    case EXPR.binary:
      return BINARY_PRECEDENCE[expr.op];
    case EXPR.not:
      return PREC.not;
    case EXPR.nullTest:
    case EXPR.arrayIncludes:
      return PREC.is;
    case EXPR.neg:
      return PREC.unary;
    case EXPR.arrayLiteral:
      return expr.parts.length > 1 ? PREC.concat : PREC.atom;
    default:
      return PREC.atom;
  }
}

export function emitExpr(expr: ExprIR, q: Qualifier, minPrecedence = 0): string {
  const precedence = precedenceOf(expr);
  const text = emitExprInner(expr, q, precedence);
  return precedence < minPrecedence ? `(${text})` : text;
}

function emitExprInner(expr: ExprIR, q: Qualifier, precedence: number): string {
  switch (expr.kind) {
    case EXPR.ref:
      return quoteIdentifier(expr.sqlName);

    case EXPR.lit:
      if (expr.value === null) return "NULL";
      if (typeof expr.value === "boolean") return expr.value ? "true" : "false";
      // An enum's literal names its type: an untyped literal resolves to text in
      // a CASE or a COALESCE, which an enum is not.
      if (typeof expr.value === "number" && Number.isNaN(expr.value)) return "'NaN'::double precision";
      if (expr.value === Infinity) return "'Infinity'::double precision";
      if (expr.value === -Infinity) return "'-Infinity'::double precision";
      if (Object.is(expr.value, -0)) return "'-0'::double precision";
      if (typeof expr.value === "string") {
        return expr.type.named?.kind === NAMED.enum
          ? `${quoteLiteral(expr.value)}::${q.scalar(expr.type)}`
          : quoteLiteral(expr.value);
      }
      // An unadorned `1.5` is `numeric` in PostgreSQL — exact decimal, not the
      // IEEE double TypeScript computed with — so fractional literals are cast,
      // and so are whole ones too wide for `integer`, which would otherwise be
      // `bigint`. Whole numbers within 32 bits are `integer` and widen implicitly.
      return expr.type.sql === PG.double && !isInt4(expr.value)
        ? `${numberLiteral(expr.value)}::double precision`
        : numberLiteral(expr.value);

    case EXPR.unicodeLit:
      return quoteUnicodeLiteral(expr.codePoints);

    case EXPR.binary: {
      // Left-associative: the right operand needs one more level to keep
      // `a - (b - c)` and `a / (b / c)` parenthesised.
      const left = emitExpr(expr.left, q, precedence);
      const right = emitExpr(expr.right, q, precedence + 1);
      return `${left} ${operatorText(expr.op)} ${right}`;
    }

    case EXPR.not:
      return `NOT ${emitExpr(expr.operand, q, PREC.not + 1)}`;

    case EXPR.neg: {
      // `-` then `-` is a comment in SQL: `-(-x)` must not be written `--x`, nor
      // the negation of a negative literal `--5`.
      const operand = emitExpr(expr.operand, q, PREC.unary);
      return operand.startsWith("-") ? `-(${operand})` : `-${operand}`;
    }

    case EXPR.nullTest:
      return `${emitExpr(expr.operand, q, PREC.is + 1)} IS ${expr.negated ? "NOT NULL" : "NULL"}`;

    case EXPR.coalesce:
      return `COALESCE(${emitExpr(expr.left, q)}, ${emitExpr(expr.right, q)})`;

    case EXPR.case:
      return `CASE WHEN ${emitExpr(expr.cond, q)} THEN ${emitExpr(expr.whenTrue, q)} ELSE ${emitExpr(expr.whenFalse, q)} END`;

    case EXPR.simpleCaseExpr:
      return `CASE ${emitExpr(expr.subject, q)} ${expr.whens
        .map((w) => `WHEN ${emitExpr(w.value, q)} THEN ${emitExpr(w.result, q)}`)
        .join(" ")} ELSE ${emitExpr(expr.orElse, q)} END`;

    case EXPR.searchedCaseExpr:
      return `CASE ${expr.whens
        .map((w) => `WHEN ${emitExpr(w.cond, q)} THEN ${emitExpr(w.result, q)}`)
        .join(" ")} ELSE ${emitExpr(expr.orElse, q)} END`;

    case EXPR.call:
      return `${q(expr.sqlName)}(${expr.args.map((a) => emitExpr(a, q)).join(", ")})`;

    case EXPR.helper:
      return `${TSQL_SCHEMA}.${expr.name}(${expr.args.map((a) => emitExpr(a, q)).join(", ")})`;

    case EXPR.builtin:
      return `${expr.sql}(${expr.args.map((a) => emitExpr(a, q)).join(", ")})`;

    case EXPR.field:
      // `(sub).plan` — the parentheses are required: `sub.plan` would be read
      // as a column reference on a table called `sub`.
      return `(${emitExpr(expr.operand, q)}).${quoteIdentifier(expr.sqlName)}`;

    case EXPR.cast:
      return `${emitExpr(expr.operand, q, PREC.atom)}::${q.scalar(expr.type)}`;

    case EXPR.row:
      // One argument per field, in field order, cast to the named
      // composite: PostgreSQL composites are nominal, so a bare ROW() will not do.
      return `ROW(${expr.args.map((a) => emitExpr(a, q)).join(", ")})::${q.type(expr.type)}`;

    case EXPR.arrayLength:
      return `cardinality(${emitExpr(expr.operand, q)})`;

    case EXPR.arrayIncludes:
      return `array_position(${emitExpr(expr.array, q)}, ${emitExpr(expr.value, q)}) IS NOT NULL`;

    case EXPR.arrayLiteral: {
      // Every run is cast: `ARRAY[]` has no type of its own, and `ARRAY[1]`
      // would not say `double precision[]` when that is what was declared.
      const arrayType = arrayTypeName(expr.type, q);
      if (expr.parts.length === 0) return `ARRAY[]::${arrayType}`;
      return expr.parts
        .map((part, i) =>
          part.kind === PART.items
            ? `ARRAY[${part.items.map((item) => emitExpr(item, q)).join(", ")}]::${arrayType}`
            : // Left-associative, like any binary operator: a later operand of
              // `||` binds one level tighter.
              emitExpr(part.array, q, i === 0 ? precedence : precedence + 1),
        )
        .join(" || ");
    }

    case EXPR.arrayCast:
      return `${emitExpr(expr.operand, q, PREC.atom)}::${arrayTypeName(expr.type, q)}`;
  }
}

function numberLiteral(value: number): string {
  if (Number.isNaN(value) || !Number.isFinite(value)) {
    // `NaN` is written by its own literal case (`emitExprInner`); an infinity is
    // unreachable — lowering rejects it — but be explicit rather than emit it.
    throw new Error(`Cannot emit non-finite number: ${value}`);
  }
  return String(value);
}

function operatorText(op: string): string {
  return op === OP.and || op === OP.or || op.startsWith("is ") ? op.toUpperCase() : op;
}
