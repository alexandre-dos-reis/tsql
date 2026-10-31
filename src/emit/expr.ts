/**
 * Expressions, with the minimum of parentheses: PostgreSQL's operator precedence is the one thing the emitter works out for itself.
 */
import { isInt4 } from "@/constants.ts";
import { TSQL_SCHEMA } from "@/helpers.ts";
import { type BinOp, type ExprIR } from "@/ir.ts";
import { quoteIdentifier, quoteLiteral } from "@/names.ts";
import { arrayTypeName, type Qualifier } from "./qualify.ts";

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
  "is distinct from": PREC.is,
  "is not distinct from": PREC.is,
  "=": PREC.comparison,
  "<>": PREC.comparison,
  "<": PREC.comparison,
  "<=": PREC.comparison,
  ">": PREC.comparison,
  ">=": PREC.comparison,
  "||": PREC.concat,
  "+": PREC.additive,
  "-": PREC.additive,
  "*": PREC.multiplicative,
  "/": PREC.multiplicative,
  "%": PREC.multiplicative,
};

function precedenceOf(expr: ExprIR): number {
  switch (expr.kind) {
    case "binary":
      return BINARY_PRECEDENCE[expr.op];
    case "not":
      return PREC.not;
    case "nullTest":
    case "arrayIncludes":
      return PREC.is;
    case "neg":
      return PREC.unary;
    case "arrayLiteral":
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
    case "ref":
      return quoteIdentifier(expr.sqlName);

    case "lit":
      if (expr.value === null) return "NULL";
      if (typeof expr.value === "boolean") return expr.value ? "true" : "false";
      // An enum's literal names its type: an untyped literal resolves to text in
      // a CASE or a COALESCE, which an enum is not.
      if (typeof expr.value === "number" && Number.isNaN(expr.value)) return "'NaN'::double precision";
      if (expr.value === Infinity) return "'Infinity'::double precision";
      if (expr.value === -Infinity) return "'-Infinity'::double precision";
      if (Object.is(expr.value, -0)) return "'-0'::double precision";
      if (typeof expr.value === "string") {
        return expr.type.named?.kind === "enum"
          ? `${quoteLiteral(expr.value)}::${q.scalar(expr.type)}`
          : quoteLiteral(expr.value);
      }
      // An unadorned `1.5` is `numeric` in PostgreSQL — exact decimal, not the
      // IEEE double TypeScript computed with — so fractional literals are cast,
      // and so are whole ones too wide for `integer`, which would otherwise be
      // `bigint`. Whole numbers within 32 bits are `integer` and widen implicitly.
      return expr.type.sql === "double precision" && !isInt4(expr.value)
        ? `${numberLiteral(expr.value)}::double precision`
        : numberLiteral(expr.value);

    case "binary": {
      // Left-associative: the right operand needs one more level to keep
      // `a - (b - c)` and `a / (b / c)` parenthesised.
      const left = emitExpr(expr.left, q, precedence);
      const right = emitExpr(expr.right, q, precedence + 1);
      return `${left} ${operatorText(expr.op)} ${right}`;
    }

    case "not":
      return `NOT ${emitExpr(expr.operand, q, PREC.not + 1)}`;

    case "neg": {
      // `-` then `-` is a comment in SQL: `-(-x)` must not be written `--x`, nor
      // the negation of a negative literal `--5`.
      const operand = emitExpr(expr.operand, q, PREC.unary);
      return operand.startsWith("-") ? `-(${operand})` : `-${operand}`;
    }

    case "nullTest":
      return `${emitExpr(expr.operand, q, PREC.is + 1)} IS ${expr.negated ? "NOT NULL" : "NULL"}`;

    case "coalesce":
      return `COALESCE(${emitExpr(expr.left, q)}, ${emitExpr(expr.right, q)})`;

    case "case":
      return `CASE WHEN ${emitExpr(expr.cond, q)} THEN ${emitExpr(expr.whenTrue, q)} ELSE ${emitExpr(expr.whenFalse, q)} END`;

    case "simpleCaseExpr":
      return `CASE ${emitExpr(expr.subject, q)} ${expr.whens
        .map((w) => `WHEN ${emitExpr(w.value, q)} THEN ${emitExpr(w.result, q)}`)
        .join(" ")} ELSE ${emitExpr(expr.orElse, q)} END`;

    case "searchedCaseExpr":
      return `CASE ${expr.whens
        .map((w) => `WHEN ${emitExpr(w.cond, q)} THEN ${emitExpr(w.result, q)}`)
        .join(" ")} ELSE ${emitExpr(expr.orElse, q)} END`;

    case "call":
      return `${q(expr.sqlName)}(${expr.args.map((a) => emitExpr(a, q)).join(", ")})`;

    case "helper":
      return `${TSQL_SCHEMA}.${expr.name}(${expr.args.map((a) => emitExpr(a, q)).join(", ")})`;

    case "builtin":
      return `${expr.sql}(${expr.args.map((a) => emitExpr(a, q)).join(", ")})`;

    case "field":
      // `(sub).plan` — the parentheses are required: `sub.plan` would be read
      // as a column reference on a table called `sub`.
      return `(${emitExpr(expr.operand, q)}).${quoteIdentifier(expr.sqlName)}`;

    case "cast":
      return `${emitExpr(expr.operand, q, PREC.atom)}::${q.scalar(expr.type)}`;

    case "row":
      // One argument per field, in field order, cast to the named
      // composite: PostgreSQL composites are nominal, so a bare ROW() will not do.
      return `ROW(${expr.args.map((a) => emitExpr(a, q)).join(", ")})::${q.type(expr.type)}`;

    case "arrayLength":
      return `cardinality(${emitExpr(expr.operand, q)})`;

    case "arrayIncludes":
      return `array_position(${emitExpr(expr.array, q)}, ${emitExpr(expr.value, q)}) IS NOT NULL`;

    case "arrayLiteral": {
      // Every run is cast: `ARRAY[]` has no type of its own, and `ARRAY[1]`
      // would not say `double precision[]` when that is what was declared.
      const arrayType = arrayTypeName(expr.type, q);
      if (expr.parts.length === 0) return `ARRAY[]::${arrayType}`;
      return expr.parts
        .map((part, i) =>
          part.kind === "items"
            ? `ARRAY[${part.items.map((item) => emitExpr(item, q)).join(", ")}]::${arrayType}`
            : // Left-associative, like any binary operator: a later operand of
              // `||` binds one level tighter.
              emitExpr(part.array, q, i === 0 ? precedence : precedence + 1),
        )
        .join(" || ");
    }

    case "arrayCast":
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
  return op === "and" || op === "or" || op.startsWith("is ") ? op.toUpperCase() : op;
}
