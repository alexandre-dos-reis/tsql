/**
 * Calls: between compiled functions, to the `int` guard, and to the helpers of the `tsql` schema.
 */
import {
  SyntaxKind,
  type CallExpression,
  type Expression,
  type Identifier,
  type Node,
  type PropertyAccessExpression,
} from "typescript/unstable/ast";
import { CompileError } from "../../errors.ts";
import { type HelperName } from "../../helpers.ts";
import { describe, isExactly, scalarType, type ExprIR, type ScalarType } from "../../ir.ts";
import { INT_GUARD, isIntGuard } from "../../typemap.ts";
import { coerce, requireAssignable } from "../coerce.ts";
import { type State } from "../state.ts";
import { referenceError, rootIdentifier } from "./access.ts";
import { arrayOperand, lowerArrayMethod } from "./array.ts";
import { lowerExpr } from "./expr.ts";
import { isMathGlobal, isNumberGlobal, lowerMathCall, lowerNumberCall } from "./globalCall.ts";

export async function lowerCall(node: CallExpression, s: State, guarded = false): Promise<ExprIR> {
  if (node.expression.kind === SyntaxKind.PropertyAccessExpression) {
    const access = node.expression as PropertyAccessExpression;
    const array = await arrayOperand(access.expression, s);
    if (array) return lowerArrayMethod(node, access, array, s);
    if (await isMathGlobal(access.expression, s)) return lowerMathCall(node, access, s, guarded);
    if (await isNumberGlobal(access.expression, s)) return lowerNumberCall(node, access, s, guarded);
  }
  if (node.expression.kind !== SyntaxKind.Identifier) {
    // `Math.max(a, b)`, `helpers.limit()`, `plan.toUpperCase()` — name what the
    // callee actually is rather than reporting an unsupported call shape.
    const root = rootIdentifier(node.expression);
    if (root && !s.scope.has(root.text)) throw await referenceError(root.text, root, node.expression, s);
    if (root) {
      throw CompileError.at(
        node.expression,
        `\`${node.expression.getText()}\` is not supported: methods on values are not part of the compiled subset.`,
      );
    }
    throw CompileError.at(node.expression, "Only direct calls to other compiled functions are supported.");
  }
  const name = (node.expression as Identifier).text;
  if (await isIntGuard(node.expression, s)) return lowerIntGuard(node, s);
  const target = s.signatures.get(name);
  if (!target) throw await referenceError(name, node.expression, node.expression, s);
  if (node.arguments.length !== target.params.length) {
    throw CompileError.at(
      node,
      `\`${name}\` expects ${target.params.length} argument(s), got ${node.arguments.length}.`,
    );
  }

  const args: ExprIR[] = [];
  for (const [i, argument] of node.arguments.entries()) {
    const param = target.params[i]!;
    const lowered = await lowerExpr(argument as Expression, s, param.type);
    requireAssignable(lowered.type, param.type, argument as Node, `argument \`${param.tsName}\``);
    args.push(coerce(lowered, param.type));
  }
  s.calls.add(target.sqlName);
  return { kind: "call", sqlName: target.sqlName, args, type: target.returns };
}

/**
 * `int(x)`, which disappears.
 *
 * The guard exists for the TypeScript side alone: it makes the function raise
 * where PostgreSQL already raises on its own, so the emitted SQL is the bare
 * expression. Its operand must already be an `integer` — erasing the guard over
 * a `double precision` would leave PostgreSQL rounding on assignment where
 * TypeScript threw, which is the divergence this is here to remove.
 */
async function lowerIntGuard(node: CallExpression, s: State): Promise<ExprIR> {
  const [argument, ...rest] = node.arguments;
  if (!argument || rest.length > 0) {
    throw CompileError.at(node, `\`${INT_GUARD}\` takes exactly one argument, got ${node.arguments.length}.`);
  }
  const operand = await lowerExpr(argument as Expression, s, scalarType("integer"), true);
  if (!isExactly(operand.type, "integer")) {
    throw CompileError.at(
      argument as Node,
      `\`${INT_GUARD}\` guards \`integer\` arithmetic, but this is \`${describe(operand.type)}\`. ` +
        `It leaves no cast behind in the SQL, so guarding a double would round in PostgreSQL where TypeScript raised. ` +
        `Annotate the operands as \`Integer\`, or drop the guard and keep the result a \`Float\`.`,
    );
  }
  return operand;
}

export const DOUBLE = scalarType("double precision");

/** A call to a helper tsql installs (`src/helpers.ts`), recorded so the migration installs it. */
export function helper(s: State, name: HelperName, args: ExprIR[], type: ScalarType): ExprIR {
  s.helpers.add(name);
  return { kind: "helper", name, args, type };
}
