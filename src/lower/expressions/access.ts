/**
 * Field access on composites, read one field at a time, and `new`.
 */
import {
  SyntaxKind,
  type Expression,
  type Identifier,
  type NewExpression,
  type Node,
  type ParenthesizedExpression,
  type PropertyAccessExpression,
} from "typescript/unstable/ast";
import { CompileError } from "@/errors";
import { mathConstant } from "@/globals/math";
import { unsupportedNumberMessage } from "@/globals/number";
import { describe, isComposite, namedType, scalarType, type ExprIR } from "@/ir";
import { classifyReference, referenceMessage } from "@/references";
import { enumMember } from "@/typemap";
import { type State } from "@/lower/state";
import { ARRAY_SUBSET, arrayOperand } from "./array";
import { DOUBLE } from "./call";
import { lowerExpr } from "./expr";
import { isMathGlobal, isNumberGlobal } from "./globalCall";

/**
 * A composite-typed base expression plus the field path read from it.
 *
 * Works uniformly for a parameter (`sub.plan`), a local, a nested field
 * (`basket.customer.tier`) and the result of a call (`grantSeat(seat).count`),
 * so field access does not care how the composite was produced.
 */
interface ResolvedAccess {
  readonly base: ExprIR;
  readonly path: readonly string[];
}

export async function resolveAccess(node: Expression, s: State): Promise<ResolvedAccess | undefined> {
  if (node.kind === SyntaxKind.ParenthesizedExpression) {
    return resolveAccess((node as ParenthesizedExpression).expression, s);
  }

  if (node.kind === SyntaxKind.PropertyAccessExpression) {
    const access = node as PropertyAccessExpression;
    if (access.name.kind !== SyntaxKind.Identifier) return undefined;
    const inner = await resolveAccess(access.expression, s);
    if (!inner) return undefined;
    return { base: inner.base, path: [...inner.path, (access.name as Identifier).text] };
  }

  if (node.kind === SyntaxKind.Identifier) {
    const binding = s.scope.get((node as Identifier).text);
    if (!binding || !isComposite(binding.type)) return undefined;
    return { base: { kind: "ref", sqlName: binding.sqlName, type: binding.type }, path: [] };
  }

  // Anything else that yields a composite: a call, an object literal.
  if (node.kind === SyntaxKind.CallExpression || node.kind === SyntaxKind.ObjectLiteralExpression) {
    const lowered = await lowerExpr(node, s);
    return isComposite(lowered.type) ? { base: lowered, path: [] } : undefined;
  }

  return undefined;
}

/**
 * Property and element access. Reached by `Math.PI`, `plan.length` and
 * `sub.plan` alike: the first is a runtime global, the second a method on a
 * built-in type, and the third a composite field.
 */
export async function lowerAccess(node: Expression, s: State): Promise<ExprIR> {
  const operand = (node as PropertyAccessExpression).expression;
  // `Math.PI` and the other constants: the double itself, as a literal.
  if (node.kind === SyntaxKind.PropertyAccessExpression && (await isMathGlobal(operand, s))) {
    const name = (node as PropertyAccessExpression).name;
    const value = name.kind === SyntaxKind.Identifier ? mathConstant((name as Identifier).text) : undefined;
    if (value !== undefined) return { kind: "lit", value, type: DOUBLE };
  }
  // `Number.MAX_SAFE_INTEGER`, `Number.EPSILON` — no member of `Number` is a
  // value that compiles, so say so here rather than letting it read as a field.
  if (node.kind === SyntaxKind.PropertyAccessExpression && (await isNumberGlobal(operand, s))) {
    const name = (node as PropertyAccessExpression).name;
    const member = name.kind === SyntaxKind.Identifier ? (name as Identifier).text : name.getText();
    throw CompileError.at(node, unsupportedNumberMessage(member));
  }
  const array = await arrayOperand(operand, s);
  if (array) {
    if (node.kind === SyntaxKind.ElementAccessExpression) {
      throw CompileError.at(
        node,
        `\`${node.getText()}\` is not supported: out of range, TypeScript gives \`undefined\` where PostgreSQL gives NULL, and a PostgreSQL array need not start at 1. Iterate with \`for … of\`.`,
      );
    }
    const name = (node as PropertyAccessExpression).name;
    if (name.kind === SyntaxKind.Identifier && (name as Identifier).text === "length") {
      return { kind: "arrayLength", operand: array, type: scalarType("integer") };
    }
    throw CompileError.at(node, `\`${node.getText()}\` is not supported. ${ARRAY_SUBSET}`);
  }

  // `AreaType.Level1`, `Plan.Free`: a member of an enum is its string, typed as the enum.
  if (node.kind === SyntaxKind.PropertyAccessExpression) {
    const access = node as PropertyAccessExpression;
    if (
      access.expression.kind === SyntaxKind.Identifier &&
      !s.scope.has((access.expression as Identifier).text) &&
      access.name.kind === SyntaxKind.Identifier
    ) {
      const member = await enumMember(access.expression, (access.name as Identifier).text, s);
      if (member) return { kind: "lit", value: member.value, type: namedType(member.named) };
    }
  }

  const resolved = await resolveAccess(node, s);
  if (resolved && isComposite(resolved.base.type) && resolved.path.length > 0) {
    return readPath(resolved.base, resolved.path, node);
  }

  const root = rootIdentifier(node);
  if (root && !s.scope.has(root.text)) {
    throw await referenceError(root.text, root, node, s);
  }
  throw CompileError.at(
    node,
    `\`${node.getText()}\` is not supported: object and element access are not part of the compiled subset. Pass the value you need as a parameter instead.`,
  );
}

/**
 * Read `path` off a composite value, one field at a time: `basket.customer.tier`
 * is `((basket).customer).tier`, since a field of an object type is a column of
 * that type's own composite. Undefined when a segment is not a field.
 */
export function tryReadPath(base: ExprIR, path: readonly string[]): ExprIR | undefined {
  let value = base;
  for (const segment of path) {
    if (!isComposite(value.type)) return undefined;
    const field = value.type.fields.find((f) => f.tsName === segment);
    if (!field) return undefined;
    value = { kind: "field", operand: value, sqlName: field.sqlName, type: field.type };
  }
  return value;
}

/** `tryReadPath`, explaining a segment that is not a field. */
export function readPath(base: ExprIR, path: readonly string[], at: Node): ExprIR {
  let value = base;
  for (const segment of path) {
    if (!isComposite(value.type)) {
      throw CompileError.at(
        at,
        `\`${at.getText()}\` is not supported: \`${describe(value.type)}\` has no fields, and methods on values are not part of the compiled subset.`,
      );
    }
    const field = value.type.fields.find((f) => f.tsName === segment);
    if (!field) throw CompileError.at(at, `\`${value.type.tsName}\` has no field \`${segment}\`.`);
    value = { kind: "field", operand: value, sqlName: field.sqlName, type: field.type };
  }
  return value;
}

export async function lowerNew(node: NewExpression, s: State): Promise<ExprIR> {
  const root = rootIdentifier(node.expression);
  if (root) throw await referenceError(root.text, root, root, s);
  throw CompileError.at(node, "`new` expressions are not supported.");
}

/**
 * Build the error for a name that is not a parameter, a local constant or a
 * compiled function, describing where the name actually comes from.
 */
export async function referenceError(name: string, at: Node, usage: Node, s: State): Promise<CompileError> {
  const reference = await classifyReference(name, at, s);
  return CompileError.at(usage, referenceMessage(reference, usage.getText()));
}

const ACCESS_KINDS = new Set<SyntaxKind>([
  SyntaxKind.PropertyAccessExpression,
  SyntaxKind.ElementAccessExpression,
  SyntaxKind.ParenthesizedExpression,
  SyntaxKind.CallExpression,
  SyntaxKind.NewExpression,
]);

/** `Math.max` -> `Math`; `new Date().getTime` -> `Date`; `fc.sample(x).length` -> `fc`. */
export function rootIdentifier(node: Expression): Identifier | undefined {
  let current: Expression = node;
  while (ACCESS_KINDS.has(current.kind)) {
    const next = (current as PropertyAccessExpression | ParenthesizedExpression).expression;
    if (!next) return undefined;
    current = next;
  }
  return current.kind === SyntaxKind.Identifier ? (current as Identifier) : undefined;
}
