/**
 * Assignments and compound assignments to locals.
 */
import { SyntaxKind, type BinaryExpression, type Expression, type Identifier } from "typescript/unstable/ast";
import { CompileError } from "../../errors.ts";
import { assignable, describe, isExactly, isNumeric, scalarType, type ExprIR, type StmtIR } from "../../ir.ts";
import { INT_GUARD } from "../../authoring.ts";
import { coerce, requireAssignable } from "../coerce.ts";
import { referenceError } from "../expressions/access.ts";
import { arithmetic, ASSIGNMENT_OPERATORS, combine } from "../expressions/binary.ts";
import { lowerExpr } from "../expressions/expr.ts";
import { type State } from "../state.ts";

const COMPOUND: ReadonlyMap<SyntaxKind, SyntaxKind> = new Map([
  [SyntaxKind.PlusEqualsToken, SyntaxKind.PlusToken],
  [SyntaxKind.MinusEqualsToken, SyntaxKind.MinusToken],
  [SyntaxKind.AsteriskEqualsToken, SyntaxKind.AsteriskToken],
  [SyntaxKind.SlashEqualsToken, SyntaxKind.SlashToken],
  [SyntaxKind.PercentEqualsToken, SyntaxKind.PercentToken],
]);

/**
 * `x = v;`, `x += v;` (and `-=`, `*=`, `/=`, `%=`), `x++;`, `x--;` as statements
 * of their own, on a `let` local. Returns undefined for any other statement.
 *
 * Reassigning a local is faithful: a PL/pgSQL variable is overwritten exactly
 * as a TypeScript one. A compound assignment is lowered as its operator would
 * be (`x += y` is `x = x + y`), so it inherits every rule of that operator, and
 * the result must still fit the variable's type — `total /= 2` on an `integer`
 * is refused, as PostgreSQL would round where TypeScript keeps the fraction.
 */
export async function lowerAssignment(expression: Expression, s: State): Promise<StmtIR | undefined> {
  let target: Expression;
  let value: (current: ExprIR) => Promise<ExprIR>;

  if (expression.kind === SyntaxKind.BinaryExpression) {
    const binary = expression as BinaryExpression;
    const op = binary.operatorToken.kind;
    if (!ASSIGNMENT_OPERATORS.has(op)) return undefined;
    if (binary.left.kind !== SyntaxKind.Identifier) return undefined; // field mutation: lowerBinary explains
    target = binary.left;
    if (op === SyntaxKind.EqualsToken) {
      value = (current) => lowerExpr(binary.right, s, current.type);
    } else {
      const base = COMPOUND.get(op);
      if (base === undefined) {
        throw CompileError.at(
          binary.operatorToken,
          `\`${binary.operatorToken.getText()}\` is not supported; write the assignment out (\`x = x … y\`).`,
        );
      }
      value = async (current) => {
        const next = combine(base, current, await lowerExpr(binary.right, s), binary, true);
        if (isExactly(next.type, "integer") && COMPOUND_OVERFLOWS.has(base)) {
          throw CompileError.at(
            binary.operatorToken,
            `\`${binary.operatorToken.getText()}\` on an \`integer\` has nowhere to put the 32-bit overflow guard. ` +
              `Write the assignment out and guard it: \`${(target as Identifier).text} = ${INT_GUARD}(${(target as Identifier).text} ${binary.operatorToken.getText().slice(0, -1)} ${binary.right.getText()})\`.`,
          );
        }
        return next;
      };
    }
  } else if (
    expression.kind === SyntaxKind.PostfixUnaryExpression ||
    expression.kind === SyntaxKind.PrefixUnaryExpression
  ) {
    // Prefix and postfix unary expressions share these two fields.
    const unary = expression as unknown as { readonly operator: SyntaxKind; readonly operand: Expression };
    if (unary.operator !== SyntaxKind.PlusPlusToken && unary.operator !== SyntaxKind.MinusMinusToken) return undefined;
    if (unary.operand.kind !== SyntaxKind.Identifier) return undefined;
    target = unary.operand;
    const op = unary.operator === SyntaxKind.PlusPlusToken ? SyntaxKind.PlusToken : SyntaxKind.MinusToken;
    value = async (current) => {
      if (!isNumeric(current.type)) {
        throw CompileError.at(expression, `\`${expression.getText()}\` needs a number.`);
      }
      const step = arithmetic(
        op === SyntaxKind.PlusToken ? "+" : "-",
        current,
        { kind: "lit", value: 1, type: scalarType("integer") },
        expression,
        true,
      );
      if (isExactly(step.type, "integer")) {
        const text = (target as Identifier).text;
        throw CompileError.at(
          expression,
          `\`${expression.getText()}\` on an \`integer\` has nowhere to put the 32-bit overflow guard. ` +
            `Write it out and guard it: \`${text} = ${INT_GUARD}(${text} ${op === SyntaxKind.PlusToken ? "+" : "-"} 1)\`.`,
        );
      }
      return step;
    };
  } else {
    return undefined;
  }

  const name = (target as Identifier).text;
  const binding = s.scope.get(name);
  if (!binding) throw await referenceError(name, target, target, s);
  if (binding.kind === "param") {
    throw CompileError.at(
      target,
      `\`${name}\` is a parameter, and parameters are not reassigned. Copy it into a variable first: \`let ${name}Value = ${name};\`.`,
    );
  }
  if (binding.kind === "const") {
    throw CompileError.at(target, `\`${name}\` is a \`const\`; declare it with \`let\` to reassign it.`);
  }

  const current: ExprIR = { kind: "ref", sqlName: binding.sqlName, type: binding.type };
  const next = await value(current);
  if (isNumeric(next.type) && isNumeric(binding.type) && !assignable(next.type, binding.type)) {
    throw CompileError.at(
      expression,
      `\`${name}\` is \`${describe(binding.type)}\` but this assigns a \`${describe(next.type)}\`, which PostgreSQL would round silently. Declare the variable wider, e.g. \`let ${name}: number = …\`.`,
    );
  }
  requireAssignable(next.type, binding.type, expression, `value assigned to \`${name}\``);
  return { kind: "assign", sqlName: binding.sqlName, expr: coerce(next, binding.type) };
}

/** `+=`, `-=`, `*=` lower to the operators that can overflow; `/=` and `%=` cannot. */
const COMPOUND_OVERFLOWS = new Set<SyntaxKind>([SyntaxKind.PlusToken, SyntaxKind.MinusToken, SyntaxKind.AsteriskToken]);
