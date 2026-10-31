/**
 * Array literals and the array members that compile.
 */
import {
  SyntaxKind,
  type ArrayLiteralExpression,
  type CallExpression,
  type Expression,
  type Identifier,
  type PropertyAccessExpression,
} from "typescript/unstable/ast";
import { CompileError } from "@/errors";
import {
  arrayType,
  describe,
  isArray,
  isComposite,
  isNumeric,
  isScalar,
  sameFamily,
  scalarType,
  widenNumeric,
  type ArrayPart,
  type ArrayType,
  type ExprIR,
  type PgType,
} from "@/ir";
import { coerce, requireAssignable, unify } from "@/lower/coerce";
import { type State } from "@/lower/state";
import { resolveAccess, tryReadPath } from "./access";
import { isNullLiteral, lowerExpr } from "./expr";

/**
 * `[a, b, ...xs]`, as `ARRAY[a, b]::t[] || xs`.
 *
 * The element type comes from the position when it has one — `readonly
 * Integer[]` keeps a `1` an `integer` and makes `[]` an `integer[]` — and
 * otherwise from the elements themselves. Each element must fit it, as an
 * assignment would; a spread must be an array whose elements do. Concatenating
 * copies, so `[...acc, x]` builds a new array and leaves `acc` as it was, in
 * both languages.
 */
export async function lowerArrayLiteral(node: ArrayLiteralExpression, s: State, expected?: PgType): Promise<ExprIR> {
  const target = expected && isArray(expected) ? expected : undefined;
  const lowered: { node: Expression; spread: boolean; expr: ExprIR }[] = [];
  for (const element of node.elements) {
    if (element.kind === SyntaxKind.OmittedExpression) {
      throw CompileError.at(node, "An array with holes is not supported: a hole is `undefined`, which SQL lacks.");
    }
    if (element.kind === SyntaxKind.SpreadElement) {
      const operand = (element as unknown as { readonly expression: Expression }).expression;
      const expr = await lowerExpr(operand, s, target);
      if (!isArray(expr.type)) {
        throw CompileError.at(element, `Only an array can be spread into an array, not \`${describe(expr.type)}\`.`);
      }
      lowered.push({ node: element, spread: true, expr });
    } else {
      lowered.push({ node: element, spread: false, expr: await lowerExpr(element, s, target?.element) });
    }
  }

  let element: PgType | undefined = target?.element;
  if (!element) {
    for (const item of lowered) {
      const type = item.spread ? (item.expr.type as ArrayType).element : item.expr.type;
      element = element ? unify(element, type, item.node, "elements of this array") : type;
    }
  }
  if (!element) {
    throw CompileError.at(
      node,
      "An empty array needs a type: annotate it (`const xs: readonly T[] = []`), or use it where an array type is expected.",
    );
  }
  if (isArray(element)) {
    throw CompileError.at(
      node,
      "Arrays of arrays are not supported: a PostgreSQL array is one multi-dimensional value, not an array of arrays.",
    );
  }
  const type = arrayType(element);

  const parts: ArrayPart[] = [];
  for (const item of lowered) {
    if (item.spread) {
      requireAssignable(item.expr.type, type, item.node, "spread array");
      parts.push({ kind: "spread", array: coerce(item.expr, type) });
      continue;
    }
    requireAssignable(item.expr.type, element, item.node, "array element");
    const value = coerce(item.expr, element);
    const last = parts.at(-1);
    if (last?.kind === "items") parts[parts.length - 1] = { kind: "items", items: [...last.items, value] };
    else parts.push({ kind: "items", items: [value] });
  }
  return { kind: "arrayLiteral", parts, type };
}

/**
 * The array an access or a method call is made on, or undefined when the
 * operand is not an array. An array is a parameter or a local, a field of an
 * object, or a conditional between those; anything else is left to the
 * caller's own error.
 */
export async function arrayOperand(
  node: Expression,
  s: State,
): Promise<(ExprIR & { readonly type: ArrayType }) | undefined> {
  // A field is resolved without lowering it, so a path that is not an array
  // (a misspelt field, say) reports its own error later, in its own words.
  if (node.kind === SyntaxKind.PropertyAccessExpression) {
    const resolved = await resolveAccess(node, s);
    const field = resolved && tryReadPath(resolved.base, resolved.path);
    if (!field || !isArray(field.type)) return undefined;
    return field as ExprIR & { readonly type: ArrayType };
  }
  if (
    node.kind !== SyntaxKind.Identifier &&
    node.kind !== SyntaxKind.ParenthesizedExpression &&
    node.kind !== SyntaxKind.ConditionalExpression &&
    node.kind !== SyntaxKind.CallExpression &&
    node.kind !== SyntaxKind.ArrayLiteralExpression
  ) {
    return undefined;
  }
  // A call to anything but a compiled function is left to `lowerCall`'s own error.
  if (node.kind === SyntaxKind.CallExpression) {
    const callee = (node as CallExpression).expression;
    if (callee.kind !== SyntaxKind.Identifier || !s.signatures.has((callee as Identifier).text)) return undefined;
  }
  if (node.kind === SyntaxKind.Identifier && !s.scope.has((node as Identifier).text)) return undefined;
  const lowered = await lowerExpr(node, s);
  return isArray(lowered.type) ? (lowered as ExprIR & { readonly type: ArrayType }) : undefined;
}

export const ARRAY_SUBSET = "On an array, the compiled subset is `.length`, `.includes(value)` and `for … of`.";

/**
 * `xs.includes(value)` on scalar elements, as `array_position(xs, value) IS NOT NULL`.
 *
 * `includes` compares with SameValueZero, and `array_position` with
 * `IS NOT DISTINCT FROM`, so both find a NULL and both treat NaN as equal to
 * itself. On objects, `includes` compares identity, which SQL cannot see.
 */
export async function lowerArrayMethod(
  node: CallExpression,
  access: PropertyAccessExpression,
  array: ExprIR & { readonly type: ArrayType },
  s: State,
): Promise<ExprIR> {
  const method = access.name.kind === SyntaxKind.Identifier ? (access.name as Identifier).text : access.name.getText();
  if (method !== "includes") {
    throw CompileError.at(access, `\`.${method}()\` is not supported. ${ARRAY_SUBSET} Write the loop out.`);
  }
  const element = array.type.element;
  if (isComposite(element)) {
    throw CompileError.at(
      node,
      "`includes` on an array of objects compares identity in TypeScript, which SQL cannot see: it compares by value. Loop and compare the fields you care about.",
    );
  }
  if (node.arguments.length !== 1) {
    throw CompileError.at(node, "`includes` takes exactly one argument here: a start index is not supported.");
  }

  const argument = node.arguments[0] as Expression;
  if (isNullLiteral(argument)) {
    const value: ExprIR = { kind: "lit", value: null, type: scalarType(element.sql, true) };
    return { kind: "arrayIncludes", array, value, type: scalarType("boolean") };
  }
  const value = await lowerExpr(argument, s);
  if (!isScalar(value.type) || !sameFamily(value.type, element)) {
    throw CompileError.at(argument, `Cannot look for \`${describe(value.type)}\` in \`${describe(array.type)}\`.`);
  }
  if (isNumeric(value.type) && widenNumeric(value.type.sql, element.sql) !== element.sql) {
    throw CompileError.at(
      argument,
      `Looking for a \`${value.type.sql}\` in \`${describe(array.type)}\` would need a cast that rounds it. Declare the array's elements as wide as the value.`,
    );
  }
  return { kind: "arrayIncludes", array, value: coerce(value, element), type: scalarType("boolean") };
}
