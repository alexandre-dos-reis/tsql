/**
 * Pass 1: a function's signature, and the declaration modifiers it is found by.
 */
import {
  SyntaxKind,
  type ArrowFunction,
  type FunctionDeclaration,
  type Identifier,
  type Node,
  type ParameterDeclaration,
} from "typescript/unstable/ast";

import { CompileError } from "@/errors";
import { type ParamIR, type SignatureIR } from "@/ir";
import { toSnakeCase } from "@/names";
import { mapTypeNode, type TypeCtx } from "@/typemap";

/**
 * A function the compiler translates: an exported `function` declaration, or an
 * exported `const` bound to an arrow function. Both carry the same parts — a
 * name, typed parameters, a return type, a body — so the rest of lowering does
 * not care which was written. An arrow's body may be a bare expression, which
 * means `return` that expression.
 */
export interface ExportedFunction {
  readonly name: Identifier;
  readonly fn: FunctionDeclaration | ArrowFunction;
}

/**
 * Pass 1: translate the declaration only. Signatures for every function in the
 * project are collected before any body is lowered, so calls between compiled
 * functions can be checked regardless of declaration order.
 */
export async function lowerSignature(exported: ExportedFunction, ctx: TypeCtx): Promise<SignatureIR> {
  const { fn } = exported;
  const tsName = exported.name.text;

  if (fn.typeParameters && fn.typeParameters.length > 0) {
    throw CompileError.at(fn.typeParameters[0]!, "Generic functions are not supported.");
  }
  if (hasModifier(fn, SyntaxKind.AsyncKeyword)) {
    throw CompileError.at(
      fn,
      "`async` and `await` are not supported: a PL/pgSQL function runs to completion with nothing to await.",
    );
  }
  if (!fn.type) {
    throw CompileError.at(fn, `Add an explicit return type to \`${tsName}\`; inferred return types are not compiled.`);
  }
  if (!fn.body) {
    throw CompileError.at(fn, `\`${tsName}\` has no body.`);
  }

  const params: ParamIR[] = [];
  for (const p of fn.parameters) {
    params.push(await lowerParameter(p, ctx));
  }

  const returns = await mapTypeNode(fn.type, ctx);
  return { tsName, sqlName: toSnakeCase(tsName), params, returns };
}

async function lowerParameter(p: ParameterDeclaration, ctx: TypeCtx): Promise<ParamIR> {
  if (p.dotDotDotToken) throw CompileError.at(p, "Rest parameters are not supported.");
  if (p.initializer) throw CompileError.at(p, "Default parameter values are not supported.");
  if (p.questionToken) {
    throw CompileError.at(p, "Optional parameters are not supported; write `T | null` to make absence explicit.");
  }
  if (p.name.kind !== SyntaxKind.Identifier) {
    throw CompileError.at(p.name, "Destructured parameters are not supported.");
  }
  if (!p.type) {
    throw CompileError.at(p, `Add an explicit type to parameter \`${(p.name as Identifier).text}\`.`);
  }
  const tsName = (p.name as Identifier).text;
  return { tsName, sqlName: toSnakeCase(tsName), type: await mapTypeNode(p.type, ctx) };
}

export function hasModifier(node: Node, kind: SyntaxKind): boolean {
  const modifiers = (node as { modifiers?: readonly Node[] }).modifiers;
  return modifiers?.some((m) => m.kind === kind) ?? false;
}

export function isExported(node: Node): boolean {
  return hasModifier(node, SyntaxKind.ExportKeyword);
}
