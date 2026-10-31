/**
 * Binary operators: arithmetic, comparison and the `int(...)` overflow guard.
 */
import { formatSyntaxKind, SyntaxKind, type BinaryExpression, type Node } from "typescript/unstable/ast";
import { CompileError } from "@/errors";
import {
  describe,
  isExactly,
  isNumeric,
  isScalar,
  scalarType,
  widenNumeric,
  withNullable,
  type BinOp,
  type ExprIR,
  type ScalarType,
} from "@/ir";
import { INT_GUARD } from "@/authoring";
import { coerce, textOf, unify } from "@/lower/coerce";
import { type State } from "@/lower/state";
import { rootIdentifier } from "./access";
import { canBeNaN, NAN, strictEquality } from "./equality";
import { isNullLiteral, lowerExpr } from "./expr";

export const ASSIGNMENT_OPERATORS = new Set<SyntaxKind>([
  SyntaxKind.EqualsToken,
  SyntaxKind.PlusEqualsToken,
  SyntaxKind.MinusEqualsToken,
  SyntaxKind.AsteriskEqualsToken,
  SyntaxKind.SlashEqualsToken,
  SyntaxKind.PercentEqualsToken,
  SyntaxKind.AsteriskAsteriskEqualsToken,
  SyntaxKind.AmpersandAmpersandEqualsToken,
  SyntaxKind.BarBarEqualsToken,
  SyntaxKind.QuestionQuestionEqualsToken,
]);

export async function lowerBinary(node: BinaryExpression, s: State, guarded = false): Promise<ExprIR> {
  const op = node.operatorToken.kind;

  if (ASSIGNMENT_OPERATORS.has(op)) {
    const target = node.left;
    if (target.kind === SyntaxKind.PropertyAccessExpression || target.kind === SyntaxKind.ElementAccessExpression) {
      // This one is not merely unsupported, it is untranslatable: the same
      // assignment is legal PL/pgSQL, but parameters are passed by value there,
      // so the caller would never observe the change TypeScript makes.
      throw CompileError.at(
        node,
        `Assigning to \`${target.getText()}\` mutates the caller's object in TypeScript, but PL/pgSQL passes a composite by value — the caller would never see the change. Build a new value instead (\`const next: T = { ...${rootIdentifier(target)?.text ?? "value"}, field: x }\`); marking the field \`readonly\` makes TypeScript reject the assignment too.`,
      );
    }
    throw CompileError.at(
      node.operatorToken,
      "An assignment is only supported as a statement of its own (`x = …;`), not inside an expression.",
    );
  }

  if (op === SyntaxKind.EqualsEqualsToken || op === SyntaxKind.ExclamationEqualsToken) {
    throw CompileError.at(node.operatorToken, "Use `===` / `!==`; loose equality has no SQL equivalent.");
  }

  // `x === null` is a null test, not a comparison: in SQL, `x = NULL` is NULL.
  if (op === SyntaxKind.EqualsEqualsEqualsToken || op === SyntaxKind.ExclamationEqualsEqualsToken) {
    const negated = op === SyntaxKind.ExclamationEqualsEqualsToken;
    if (isNullLiteral(node.right)) {
      return { kind: "nullTest", operand: await lowerExpr(node.left, s), negated, type: scalarType("boolean") };
    }
    if (isNullLiteral(node.left)) {
      return { kind: "nullTest", operand: await lowerExpr(node.right, s), negated, type: scalarType("boolean") };
    }
  }

  const left = await lowerExpr(node.left, s);
  const right = await lowerExpr(node.right, s);
  return combine(op, left, right, node, guarded);
}

/**
 * The value of `left op right`, both already lowered. Shared by binary
 * expressions and compound assignment (`x += y` is `x = x + y`).
 */
export function combine(op: SyntaxKind, left: ExprIR, right: ExprIR, node: BinaryExpression, guarded = false): ExprIR {
  switch (op) {
    case SyntaxKind.EqualsEqualsEqualsToken:
    case SyntaxKind.ExclamationEqualsEqualsToken: {
      return strictEquality(left, right, op === SyntaxKind.ExclamationEqualsEqualsToken, node);
    }

    case SyntaxKind.LessThanToken:
    case SyntaxKind.LessThanEqualsToken:
    case SyntaxKind.GreaterThanToken:
    case SyntaxKind.GreaterThanEqualsToken: {
      // Ordering comparison on text would depend on the database collation,
      // which does not match TypeScript's UTF-16 code unit order.
      if (!isNumeric(left.type) || !isNumeric(right.type)) {
        throw CompileError.at(
          node,
          `Ordering comparisons are only supported on numbers (got \`${describe(left.type)}\` and \`${describe(right.type)}\`). Text ordering depends on the database collation and would not match TypeScript.`,
        );
      }
      const binOp: BinOp =
        op === SyntaxKind.LessThanToken
          ? "<"
          : op === SyntaxKind.LessThanEqualsToken
            ? "<="
            : op === SyntaxKind.GreaterThanToken
              ? ">"
              : ">=";
      const comparison: ExprIR = {
        kind: "binary",
        op: binOp,
        left,
        right,
        type: scalarType("boolean", left.type.nullable || right.type.nullable),
      };
      // PostgreSQL sorts `NaN` above every number, so `NaN > 1` and `1 < NaN` are true there; in
      // JavaScript every ordering with a `NaN` is false. The side that PostgreSQL makes wrongly true
      // is the one that is `NaN`: the left of `>` and `>=`, the right of `<` and `<=`.
      const checked = binOp === ">" || binOp === ">=" ? left : right;
      if (!canBeNaN(checked)) return comparison;
      return {
        kind: "binary",
        op: "and",
        left: comparison,
        right: { kind: "binary", op: "<>", left: checked, right: NAN, type: scalarType("boolean") },
        type: comparison.type,
      };
    }

    case SyntaxKind.PlusToken: {
      if (isExactly(left.type, "text") && isExactly(right.type, "text")) {
        if (left.type.nullable || right.type.nullable) {
          throw CompileError.at(
            node,
            'Concatenating a nullable text value would yield NULL in SQL but "null" in TypeScript; narrow the operands first.',
          );
        }
        return { kind: "binary", op: "||", left: textOf(left), right: textOf(right), type: scalarType("text") };
      }
      return arithmetic("+", left, right, node, guarded);
    }

    case SyntaxKind.MinusToken:
      return arithmetic("-", left, right, node, guarded);
    case SyntaxKind.AsteriskToken:
      return arithmetic("*", left, right, node, guarded);

    case SyntaxKind.SlashToken: {
      numericOperands(left, right, node, "/");
      // Integer division truncates in PostgreSQL but not in TypeScript.
      const nullable = left.type.nullable || right.type.nullable;
      const result = scalarType("double precision", nullable);
      const dividend: ExprIR = isExactly(left.type, "double precision")
        ? left
        : {
            kind: "cast",
            operand: left,
            to: "double precision",
            type: scalarType("double precision", left.type.nullable),
          };
      return { kind: "binary", op: "/", left: dividend, right, type: result };
    }

    case SyntaxKind.PercentToken: {
      numericOperands(left, right, node, "%");
      if (isExactly(left.type, "double precision") || isExactly(right.type, "double precision")) {
        throw CompileError.at(
          node,
          "`%` is not defined for `double precision` in PostgreSQL. Annotate the operands as `Integer`.",
        );
      }
      return arithmetic("%", left, right, node, true);
    }

    case SyntaxKind.AmpersandAmpersandToken:
    case SyntaxKind.BarBarToken: {
      if (!isExactly(left.type, "boolean") || !isExactly(right.type, "boolean")) {
        throw CompileError.at(
          node,
          `\`${op === SyntaxKind.BarBarToken ? "||" : "&&"}\` needs boolean operands (got \`${describe(left.type)}\` and \`${describe(right.type)}\`). TypeScript returns the operand value, which SQL cannot express.`,
        );
      }
      return {
        kind: "binary",
        op: op === SyntaxKind.BarBarToken ? "or" : "and",
        left,
        right,
        type: scalarType("boolean", left.type.nullable || right.type.nullable),
      };
    }

    case SyntaxKind.QuestionQuestionToken: {
      const type = unify(withNullable(left.type, false), right.type, node, "operands of `??`");
      return {
        kind: "coalesce",
        left: coerce(left, withNullable(type, left.type.nullable)),
        right: coerce(right, type),
        type: withNullable(type, right.type.nullable),
      };
    }

    default:
      throw CompileError.at(node.operatorToken, `Operator \`${formatSyntaxKind(op)}\` is not supported.`);
  }
}

export function arithmetic(op: BinOp, left: ExprIR, right: ExprIR, node: Node, guarded = false): ExprIR {
  const [a, b] = numericOperands(left, right, node, op);
  const sql = widenNumeric(a.sql, b.sql);
  if (sql === "integer" && OVERFLOWS.has(op) && !guarded) throw unguarded(op, "This", node);
  return { kind: "binary", op, left, right, type: scalarType(sql, a.nullable || b.nullable) };
}

/**
 * The operators whose `integer` result can leave 32 bits. `%` cannot — its
 * result is smaller than its divisor — and `/` yields `double precision`.
 */
const OVERFLOWS = new Set<BinOp>(["+", "-", "*"]);

/**
 * Unguarded `integer` arithmetic.
 *
 * This is the one divergence the compiler cannot close on its own: PostgreSQL
 * raises `integer out of range`, TypeScript carries on into the doubles past
 * 32 bits, and nothing emitted here runs on the TypeScript side. So the author
 * is asked to close it, with a guard that costs nothing in the SQL.
 */
export function unguarded(op: string, what: string, node: Node): CompileError {
  return CompileError.at(
    node,
    `${what} \`${op}\` can overflow 32 bits, which PostgreSQL refuses (\`integer out of range\`) where TypeScript keeps counting in doubles. ` +
      `Wrap it in \`${INT_GUARD}(...)\` (\`import { ${INT_GUARD} } from "@adrdp/tsql"\`) so both sides raise — one guard per operation, so \`${INT_GUARD}(a + ${INT_GUARD}(b * c))\` — ` +
      `or annotate the result as \`Float\` to compute in doubles, which both languages do alike.`,
  );
}

/** Checks both operands are numeric and hands back their scalar types. */
function numericOperands(left: ExprIR, right: ExprIR, node: Node, op: string): [ScalarType, ScalarType] {
  if (!isScalar(left.type) || !isScalar(right.type) || !isNumeric(left.type) || !isNumeric(right.type)) {
    throw CompileError.at(
      node,
      `\`${op}\` needs numeric operands (got \`${describe(left.type)}\` and \`${describe(right.type)}\`).`,
    );
  }
  return [left.type, right.type];
}
