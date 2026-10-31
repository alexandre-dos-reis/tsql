/**
 * Pass 2: a function's body, lowered against the signatures of Pass 1.
 */
import { SyntaxKind, type Block, type Expression } from "typescript/unstable/ast";
import { CompileError } from "@/errors.ts";
import { type FunctionIR, type SignatureIR } from "@/ir.ts";
import { type TypeCtx } from "@/typemap";
import { type ExportedFunction } from "./signature.ts";
import { type State } from "./state.ts";
import { alwaysReturns, lowerReturn, lowerStatements } from "./statements/statement.ts";

/** Pass 2: translate the body against the already-known signatures. */
export async function lowerFunction(
  exported: ExportedFunction,
  signature: SignatureIR,
  module: string,
  signatures: ReadonlyMap<string, SignatureIR>,
  ctx: TypeCtx,
): Promise<FunctionIR> {
  const state: State = {
    ...ctx,
    signatures,
    scope: new Map(
      signature.params.map((p) => [p.tsName, { sqlName: p.sqlName, type: p.type, kind: "param" as const }]),
    ),
    locals: [],
    used: new Set(signature.params.map((p) => p.sqlName)),
    returns: signature.returns,
    targets: [],
    helpers: new Set(),
    calls: new Set(),
  };

  const { fn } = exported;
  // `(…) => expr` is `(…) => { return expr; }`.
  const body =
    fn.body!.kind === SyntaxKind.Block
      ? await lowerStatements((fn.body as Block).statements, state)
      : [await lowerReturn(fn.body as Expression, state)];

  if (!alwaysReturns(body)) {
    throw CompileError.at(
      fn,
      `\`${signature.tsName}\` can finish without returning. PL/pgSQL raises at runtime when control reaches the end of a function, so every path must return.`,
    );
  }

  return {
    tsName: signature.tsName,
    sqlName: signature.sqlName,
    module,
    params: signature.params,
    returns: signature.returns,
    locals: state.locals,
    body,
    helpers: [...state.helpers].sort(),
    calls: [...state.calls].sort(),
    language: "plpgsql",
  };
}
