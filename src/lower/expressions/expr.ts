/**
 * Expressions: the dispatcher, and the forms too small for a module of their own.
 */
import {
  formatSyntaxKind,
  SyntaxKind,
  type ArrayLiteralExpression,
  type BinaryExpression,
  type CallExpression,
  type ConditionalExpression,
  type Expression,
  type Identifier,
  type NewExpression,
  type NumericLiteral,
  type ObjectLiteralExpression,
  type ParenthesizedExpression,
  type PrefixUnaryExpression,
  type StringLiteral,
  type TemplateExpression,
} from "typescript/unstable/ast";
import { INT4_MAX, INT4_MIN, isInt4 } from "@/constants.ts";
import { CompileError } from "@/errors.ts";
import { describe, isExactly, isNumeric, isScalar, scalarType, type ExprIR, type PgType } from "@/ir.ts";
import { coerce, textOf, unify } from "@/lower/coerce.ts";
import { type State } from "@/lower/state.ts";
import { lowerAccess, lowerNew, referenceError } from "./access.ts";
import { lowerArrayLiteral } from "./array.ts";
import { lowerBinary, unguarded } from "./binary.ts";
import { lowerCall } from "./call.ts";
import { lowerObjectLiteral } from "./object.ts";

/**
 * Lower an expression. `expected`, when the position has one — a return, an
 * annotated declaration, an assignment, an argument, an object field — types
 * what has no type of its own: `[]`, and `null`.
 *
 * `guarded` says this expression sits directly inside `int(...)`, which is what
 * makes an overflowing `integer` operation translatable. It is deliberately not
 * propagated past one operation: only parentheses carry it, so the operands of
 * a guarded `+` are themselves unguarded and nested arithmetic needs its own
 * `int(...)`. PostgreSQL raises on an intermediate overflow even when the final
 * result would fit, so a single guard around the whole expression would not be
 * the same program.
 */
export async function lowerExpr(node: Expression, s: State, expected?: PgType, guarded = false): Promise<ExprIR> {
  switch (node.kind) {
    case SyntaxKind.ParenthesizedExpression:
      return lowerExpr((node as ParenthesizedExpression).expression, s, expected, guarded);

    case SyntaxKind.StringLiteral:
    case SyntaxKind.NoSubstitutionTemplateLiteral:
      return { kind: "lit", value: (node as StringLiteral).text, type: scalarType("text") };

    case SyntaxKind.TemplateExpression:
      return lowerTemplate(node as TemplateExpression, s);

    case SyntaxKind.TaggedTemplateExpression:
      throw CompileError.at(
        node,
        "Tagged templates are not supported: the tag is a function called with the pieces, which has no PL/pgSQL equivalent.",
      );

    case SyntaxKind.NumericLiteral: {
      const value = Number((node as NumericLiteral).text);
      // A whole literal is an `integer` only within 32 bits. Beyond them
      // PostgreSQL has no `integer` to hold it, so where one is wanted the
      // literal is refused outright rather than reported as a narrowing — it is
      // out of range, not merely fractional.
      const whole = isInt4(value);
      if (!whole && Number.isInteger(value) && expected && isExactly(expected, "integer")) {
        throw CompileError.at(
          node,
          `${value} is outside PostgreSQL's \`integer\` (${INT4_MIN} .. ${INT4_MAX}), so it cannot be an \`Integer\`. Declare it a \`Float\` to hold it as a double, as TypeScript does.`,
        );
      }
      return { kind: "lit", value, type: scalarType(whole ? "integer" : "double precision") };
    }

    case SyntaxKind.TrueKeyword:
      return { kind: "lit", value: true, type: scalarType("boolean") };
    case SyntaxKind.FalseKeyword:
      return { kind: "lit", value: false, type: scalarType("boolean") };
    case SyntaxKind.NullKeyword:
      // `null` is NULL of whatever type is expected; with nothing expected it
      // still needs a type, and only a comparison with it can follow.
      return {
        kind: "lit",
        value: null,
        type:
          expected && isScalar(expected)
            ? scalarType(expected.sql, true, expected.allowed)
            : scalarType("boolean", true),
      };

    case SyntaxKind.Identifier: {
      const name = (node as Identifier).text;
      const binding = s.scope.get(name);
      if (!binding) throw await referenceError(name, node, node, s);
      return { kind: "ref", sqlName: binding.sqlName, type: binding.type };
    }

    case SyntaxKind.PropertyAccessExpression:
    case SyntaxKind.ElementAccessExpression:
      return lowerAccess(node, s);

    case SyntaxKind.AwaitExpression:
      throw CompileError.at(
        node,
        "`await` is not supported: a PL/pgSQL function runs to completion with nothing to await.",
      );

    case SyntaxKind.NewExpression:
      return lowerNew(node as NewExpression, s);

    case SyntaxKind.PrefixUnaryExpression:
      return lowerPrefixUnary(node as PrefixUnaryExpression, s, guarded);

    case SyntaxKind.BinaryExpression:
      return lowerBinary(node as BinaryExpression, s, guarded);

    case SyntaxKind.ConditionalExpression:
      return lowerConditional(node as ConditionalExpression, s, expected);

    case SyntaxKind.ArrayLiteralExpression:
      return lowerArrayLiteral(node as ArrayLiteralExpression, s, expected);

    case SyntaxKind.CallExpression:
      return lowerCall(node as CallExpression, s, guarded);

    case SyntaxKind.ObjectLiteralExpression:
      return lowerObjectLiteral(node as ObjectLiteralExpression, s);

    default:
      throw CompileError.at(node, `${formatSyntaxKind(node.kind)} is not supported in a compiled expression.`);
  }
}

/**
 * `` `${plan}-${region}` `` is `plan || '-' || region`.
 *
 * A substitution is converted with `String(value)` in TypeScript, so only the
 * types whose text is the same in both languages are accepted: text as is,
 * `Integer` and `boolean` with `::text` — `String(42)` is `'42'` and
 * `String(true)` is `'true'`, as `42::text` and `true::text` are. A double is
 * refused: `String(0.1 + 0.2)` is `0.30000000000000004` and `1e21` keeps its
 * exponent, where PostgreSQL writes its own shortest form; a `numeric` keeps
 * trailing zeros (`1.10`). A nullable value is refused as for `+`: TypeScript
 * writes `null` where SQL's `||` makes the whole string NULL.
 */
async function lowerTemplate(node: TemplateExpression, s: State): Promise<ExprIR> {
  const text = scalarType("text");
  const pieces: ExprIR[] = [];
  const literal = (value: string) => {
    if (value !== "") pieces.push({ kind: "lit", value, type: text });
  };

  literal(node.head.text);
  for (const span of node.templateSpans) {
    const value = await lowerExpr(span.expression, s);
    if (value.type.nullable) {
      throw CompileError.at(
        span.expression,
        `\`${span.expression.getText()}\` may be null: a template literal writes "null" in TypeScript, but SQL's \`||\` makes the whole string NULL. Narrow it first, or write the fallback with \`??\`.`,
      );
    }
    if (isExactly(value.type, "text")) {
      // An enum is written as its label, like `String(value)`, once cast to text.
      pieces.push(textOf(value));
    } else if (isExactly(value.type, "integer") || isExactly(value.type, "boolean")) {
      pieces.push({ kind: "cast", operand: value, to: "text", type: text });
    } else {
      throw CompileError.at(
        span.expression,
        isNumeric(value.type)
          ? `A \`${describe(value.type)}\` in a template literal is not supported: TypeScript and PostgreSQL write fractional numbers differently (\`String(0.1 + 0.2)\`, \`1e21\`, trailing zeros). Only text, \`Integer\` and \`boolean\` are written the same way.`
          : `A \`${describe(value.type)}\` in a template literal is not supported: only text, \`Integer\` and \`boolean\` are written the same way in both languages.`,
      );
    }
    literal(span.literal.text);
  }

  if (pieces.length === 0) return { kind: "lit", value: "", type: text };
  return pieces.reduce((left, right): ExprIR => ({ kind: "binary", op: "||", left, right, type: text }));
}

async function lowerPrefixUnary(node: PrefixUnaryExpression, s: State, guarded = false): Promise<ExprIR> {
  const operand = await lowerExpr(node.operand as Expression, s);
  switch (node.operator) {
    case SyntaxKind.ExclamationToken: {
      if (!isExactly(operand.type, "boolean") || !isScalar(operand.type)) {
        throw CompileError.at(node, `\`!\` needs a boolean operand, not \`${describe(operand.type)}\`.`);
      }
      return { kind: "not", operand, type: operand.type };
    }
    case SyntaxKind.MinusToken: {
      if (!isNumeric(operand.type) || !isScalar(operand.type)) {
        throw CompileError.at(node, `Unary \`-\` needs a numeric operand, not \`${describe(operand.type)}\`.`);
      }
      // `-(-2147483648)` is the one input that overflows, and it overflows in
      // PostgreSQL only. A negative literal is already folded by the time it
      // gets here, and its range was checked where it was read.
      if (isExactly(operand.type, "integer") && !guarded && operand.kind !== "lit") {
        throw unguarded("-", "Negating", node);
      }
      return { kind: "neg", operand, type: operand.type };
    }
    default:
      throw CompileError.at(node, `Unary \`${formatSyntaxKind(node.operator)}\` is not supported.`);
  }
}

async function lowerConditional(node: ConditionalExpression, s: State, expected?: PgType): Promise<ExprIR> {
  const cond = await lowerExpr(node.condition, s);
  if (!isExactly(cond.type, "boolean")) {
    throw CompileError.at(
      node.condition,
      `A conditional expression needs a boolean condition, not \`${describe(cond.type)}\`.`,
    );
  }
  const whenTrue = await lowerExpr(node.whenTrue, s, expected);
  const whenFalse = await lowerExpr(node.whenFalse, s, expected);
  const type = unify(whenTrue.type, whenFalse.type, node, "branches of a conditional expression");
  return { kind: "case", cond, whenTrue: coerce(whenTrue, type), whenFalse: coerce(whenFalse, type), type };
}

export function isNullLiteral(node: Expression): boolean {
  return node.kind === SyntaxKind.NullKeyword;
}
