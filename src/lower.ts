import {
  NodeFlags,
  SyntaxKind,
  formatSyntaxKind,
  type BinaryExpression,
  type Block,
  type CallExpression,
  type ConditionalExpression,
  type Expression,
  type ExpressionStatement,
  type FunctionDeclaration,
  type Identifier,
  type IfStatement,
  type NewExpression,
  type Node,
  type NumericLiteral,
  type ParameterDeclaration,
  type ParenthesizedExpression,
  type PropertyAccessExpression,
  type PrefixUnaryExpression,
  type ReturnStatement,
  type Statement,
  type StringLiteral,
  type VariableStatement,
} from "typescript/unstable/ast";
import { CompileError } from "./errors.ts";
import {
  describe,
  fieldLabel,
  isComposite,
  isExactly,
  isNumeric,
  isScalar,
  sameFamily,
  scalarType,
  widenNumeric,
  withNullable,
  type BinOp,
  type ExprIR,
  type FunctionIR,
  type LocalIR,
  type ParamIR,
  type PgScalar,
  type PgType,
  type ScalarType,
  type SignatureIR,
  type StmtIR,
} from "./ir.ts";
import { toSnakeCase } from "./names.ts";
import { classifyReference, referenceMessage } from "./references.ts";
import { mapInferredType, mapTypeNode, type TypeCtx } from "./typemap.ts";

interface Binding {
  readonly sqlName: string;
  readonly type: PgType;
}

interface State extends TypeCtx {
  readonly signatures: ReadonlyMap<string, SignatureIR>;
  readonly scope: Map<string, Binding>;
  readonly locals: LocalIR[];
  readonly used: Set<string>;
  readonly returns: PgType;
}

/* -------------------------------------------------------------------------- */
/* Signatures                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Pass 1: translate the declaration only. Signatures for every function in the
 * project are collected before any body is lowered, so calls between compiled
 * functions can be checked regardless of declaration order.
 */
export async function lowerSignature(fn: FunctionDeclaration, ctx: TypeCtx): Promise<SignatureIR> {
  if (!fn.name) throw CompileError.at(fn, "Anonymous functions cannot be compiled.");
  const tsName = fn.name.text;

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
  if (!isScalar(returns)) {
    throw CompileError.at(
      fn.type,
      `\`${tsName}\` returns \`${describe(returns)}\`. Returning an object is not supported: there is no way to build one in the compiled subset. Return a scalar, or a field of it.`,
    );
  }

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

/* -------------------------------------------------------------------------- */
/* Bodies                                                                     */
/* -------------------------------------------------------------------------- */

/** Pass 2: translate the body against the already-known signatures. */
export async function lowerFunction(
  fn: FunctionDeclaration,
  signature: SignatureIR,
  module: string,
  signatures: ReadonlyMap<string, SignatureIR>,
  ctx: TypeCtx,
): Promise<FunctionIR> {
  const state: State = {
    ...ctx,
    signatures,
    scope: new Map(signature.params.map((p) => [p.tsName, { sqlName: p.sqlName, type: p.type }])),
    locals: [],
    used: new Set(signature.params.map((p) => p.sqlName)),
    returns: signature.returns,
  };

  const body = await lowerStatements(fn.body!.statements, state);

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
  };
}

async function lowerStatements(statements: readonly Statement[], s: State): Promise<StmtIR[]> {
  const out: StmtIR[] = [];
  for (const statement of statements) {
    out.push(...(await lowerStatement(statement, s)));
  }
  return out;
}

async function lowerStatement(node: Statement, s: State): Promise<StmtIR[]> {
  switch (node.kind) {
    case SyntaxKind.Block:
      return lowerStatements((node as Block).statements, s);

    case SyntaxKind.ReturnStatement: {
      const expr = (node as ReturnStatement).expression;
      if (!expr) throw CompileError.at(node, "`return` must return a value.");
      const value = await lowerExpr(expr, s);
      requireAssignable(value.type, s.returns, expr, "return value");
      return [{ kind: "return", expr: coerce(value, s.returns) }];
    }

    case SyntaxKind.IfStatement:
      return [await lowerIf(node as IfStatement, s)];

    case SyntaxKind.VariableStatement:
      return lowerVariableStatement(node as VariableStatement, s);

    case SyntaxKind.ExpressionStatement: {
      // Lower it first: if it reaches for a runtime global, that is the more
      // useful error to report.
      await lowerExpr((node as ExpressionStatement).expression, s);
      throw CompileError.at(node, "This statement's value is discarded, which has no effect in a pure function.");
    }

    default:
      throw CompileError.at(
        node,
        `${formatSyntaxKind(node.kind)} is not supported. The compiled subset is: \`const\` declarations, \`if\`/\`else\` and \`return\`.`,
      );
  }
}

async function lowerIf(node: IfStatement, s: State): Promise<StmtIR> {
  const branches: { cond: ExprIR; body: StmtIR[] }[] = [];
  let current: IfStatement | undefined = node;
  let orElse: StmtIR[] | undefined;

  while (current) {
    const cond = await lowerExpr(current.expression, s);
    if (!isExactly(cond.type, "boolean")) {
      throw CompileError.at(
        current.expression,
        `An \`if\` condition must be a boolean, not \`${describe(cond.type)}\`. Truthiness is not translated — compare explicitly.`,
      );
    }
    branches.push({ cond, body: await lowerStatements(asStatements(current.thenStatement), s) });

    const alternate: Statement | undefined = current.elseStatement;
    if (alternate && alternate.kind === SyntaxKind.IfStatement) {
      current = alternate as IfStatement;
      continue;
    }
    if (alternate) orElse = await lowerStatements(asStatements(alternate), s);
    current = undefined;
  }

  return orElse ? { kind: "if", branches, orElse } : { kind: "if", branches };
}

function asStatements(node: Statement): readonly Statement[] {
  return node.kind === SyntaxKind.Block ? (node as Block).statements : [node];
}

async function lowerVariableStatement(node: VariableStatement, s: State): Promise<StmtIR[]> {
  if (!(node.declarationList.flags & NodeFlags.Const)) {
    throw CompileError.at(node, "Only `const` declarations are supported; `let` and `var` would need mutable state.");
  }

  const out: StmtIR[] = [];
  for (const declaration of node.declarationList.declarations) {
    if (declaration.name.kind !== SyntaxKind.Identifier) {
      throw CompileError.at(declaration.name, "Destructuring is not supported.");
    }
    const tsName = (declaration.name as Identifier).text;
    if (!declaration.initializer) {
      throw CompileError.at(declaration, `\`${tsName}\` must be initialised.`);
    }
    if (s.scope.has(tsName)) {
      throw CompileError.at(declaration.name, `\`${tsName}\` shadows an existing binding.`);
    }

    const init = await lowerExpr(declaration.initializer, s);
    const declared = declaration.type
      ? await mapTypeNode(declaration.type, s)
      : await inferLocalType(init, declaration.initializer, s);
    requireAssignable(init.type, declared, declaration.initializer, `initialiser for \`${tsName}\``);

    const sqlName = uniqueName(toSnakeCase(tsName), s.used);
    s.scope.set(tsName, { sqlName, type: declared });
    s.locals.push({ tsName, sqlName, type: declared });
    out.push({ kind: "assign", sqlName, expr: coerce(init, declared) });
  }
  return out;
}

/**
 * A `const` without an annotation takes the type the expression produced.
 * The checker is consulted too, so that an annotation-free `const` whose
 * TypeScript type we could not represent is still rejected with a good message.
 */
async function inferLocalType(init: ExprIR, at: Expression, s: State): Promise<PgType> {
  const checked = await s.checker.getTypeAtLocation(at);
  if (checked) await mapInferredType(checked, at, s);
  return init.type;
}

function uniqueName(base: string, used: Set<string>): string {
  let name = base;
  let n = 2;
  while (used.has(name)) name = `${base}_${n++}`;
  used.add(name);
  return name;
}

/* -------------------------------------------------------------------------- */
/* Expressions                                                                */
/* -------------------------------------------------------------------------- */

async function lowerExpr(node: Expression, s: State): Promise<ExprIR> {
  switch (node.kind) {
    case SyntaxKind.ParenthesizedExpression:
      return lowerExpr((node as ParenthesizedExpression).expression, s);

    case SyntaxKind.StringLiteral:
      return { kind: "lit", value: (node as StringLiteral).text, type: scalarType("text") };

    case SyntaxKind.NumericLiteral: {
      const value = Number((node as NumericLiteral).text);
      return { kind: "lit", value, type: scalarType(Number.isInteger(value) ? "integer" : "double precision") };
    }

    case SyntaxKind.TrueKeyword:
      return { kind: "lit", value: true, type: scalarType("boolean") };
    case SyntaxKind.FalseKeyword:
      return { kind: "lit", value: false, type: scalarType("boolean") };
    case SyntaxKind.NullKeyword:
      return { kind: "lit", value: null, type: scalarType("boolean", true) };

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
      return lowerPrefixUnary(node as PrefixUnaryExpression, s);

    case SyntaxKind.BinaryExpression:
      return lowerBinary(node as BinaryExpression, s);

    case SyntaxKind.ConditionalExpression:
      return lowerConditional(node as ConditionalExpression, s);

    case SyntaxKind.CallExpression:
      return lowerCall(node as CallExpression, s);

    default:
      throw CompileError.at(node, `${formatSyntaxKind(node.kind)} is not supported in a compiled expression.`);
  }
}

async function lowerPrefixUnary(node: PrefixUnaryExpression, s: State): Promise<ExprIR> {
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
      return { kind: "neg", operand, type: operand.type };
    }
    default:
      throw CompileError.at(node, `Unary \`${formatSyntaxKind(node.operator)}\` is not supported.`);
  }
}

async function lowerConditional(node: ConditionalExpression, s: State): Promise<ExprIR> {
  const cond = await lowerExpr(node.condition, s);
  if (!isExactly(cond.type, "boolean")) {
    throw CompileError.at(
      node.condition,
      `A conditional expression needs a boolean condition, not \`${describe(cond.type)}\`.`,
    );
  }
  const whenTrue = await lowerExpr(node.whenTrue, s);
  const whenFalse = await lowerExpr(node.whenFalse, s);
  const type = unify(whenTrue.type, whenFalse.type, node, "branches of a conditional expression");
  return { kind: "case", cond, whenTrue: coerce(whenTrue, type), whenFalse: coerce(whenFalse, type), type };
}

async function lowerCall(node: CallExpression, s: State): Promise<ExprIR> {
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
    const lowered = await lowerExpr(argument as Expression, s);
    requireAssignable(lowered.type, param.type, argument as Node, `argument \`${param.tsName}\``);
    args.push(coerce(lowered, param.type));
  }
  return { kind: "call", sqlName: target.sqlName, args, type: target.returns };
}

/**
 * Property and element access. Reached by `Math.PI`, `plan.length` and
 * `policy.plan` alike: the first is a runtime global, the second a method on a
 * built-in type, and the third an object field the subset does not model yet.
 */
async function lowerAccess(node: Expression, s: State): Promise<ExprIR> {
  // `sub.plan`, `nested.foo.bar` — a reference to a flattened composite field.
  const chain = accessChain(node);
  if (chain) {
    const binding = s.scope.get(chain.root.text);
    if (binding && isComposite(binding.type)) {
      const field = binding.type.fields.find((f) => samePath(f.path, chain.path));
      if (field) {
        return {
          kind: "field",
          operand: { kind: "ref", sqlName: binding.sqlName, type: binding.type },
          sqlName: field.sqlName,
          type: field.type,
        };
      }

      // A partial path names a nested shape rather than a value. After
      // flattening there is no column for the group itself.
      const label = fieldLabel(chain.path);
      const leaves = binding.type.fields.filter((f) => startsWith(f.path, chain.path));
      if (leaves.length > 0) {
        throw CompileError.at(
          node,
          `\`${chain.root.text}.${label}\` is a nested shape, not a value. Reference a leaf instead: ${leaves
            .map((f) => `\`${chain.root.text}.${fieldLabel(f.path)}\``)
            .join(", ")}.`,
        );
      }
      throw CompileError.at(node, `\`${binding.type.tsName}\` has no field \`${label}\`.`);
    }
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

async function lowerNew(node: NewExpression, s: State): Promise<ExprIR> {
  const root = rootIdentifier(node.expression);
  if (root) throw await referenceError(root.text, root, root, s);
  throw CompileError.at(node, "`new` expressions are not supported.");
}

/**
 * Build the error for a name that is not a parameter, a local constant or a
 * compiled function, describing where the name actually comes from.
 */
async function referenceError(name: string, at: Node, usage: Node, s: State): Promise<CompileError> {
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

/**
 * Decompose a plain property-access chain into its root and field path:
 * `nested.foo.bar` -> root `nested`, path `["foo", "bar"]`. Returns undefined
 * for anything that is not a chain of plain property accesses.
 */
function accessChain(node: Expression): { root: Identifier; path: string[] } | undefined {
  const path: string[] = [];
  let current: Expression = node;
  while (current.kind === SyntaxKind.PropertyAccessExpression) {
    const access = current as PropertyAccessExpression;
    if (access.name.kind !== SyntaxKind.Identifier) return undefined;
    path.unshift((access.name as Identifier).text);
    current = access.expression;
  }
  if (current.kind !== SyntaxKind.Identifier || path.length === 0) return undefined;
  return { root: current as Identifier, path };
}

function samePath(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((segment, i) => segment === b[i]);
}

function startsWith(path: readonly string[], prefix: readonly string[]): boolean {
  return prefix.length < path.length && prefix.every((segment, i) => segment === path[i]);
}

/** `Math.max` -> `Math`; `new Date().getTime` -> `Date`; `fc.sample(x).length` -> `fc`. */
function rootIdentifier(node: Expression): Identifier | undefined {
  let current: Expression = node;
  while (ACCESS_KINDS.has(current.kind)) {
    const next = (current as PropertyAccessExpression | ParenthesizedExpression).expression;
    if (!next) return undefined;
    current = next;
  }
  return current.kind === SyntaxKind.Identifier ? (current as Identifier) : undefined;
}

const ASSIGNMENT_OPERATORS = new Set<SyntaxKind>([
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

async function lowerBinary(node: BinaryExpression, s: State): Promise<ExprIR> {
  const op = node.operatorToken.kind;

  if (ASSIGNMENT_OPERATORS.has(op)) {
    const target = node.left;
    if (target.kind === SyntaxKind.PropertyAccessExpression || target.kind === SyntaxKind.ElementAccessExpression) {
      // This one is not merely unsupported, it is untranslatable: the same
      // assignment is legal PL/pgSQL, but parameters are passed by value there,
      // so the caller would never observe the change TypeScript makes.
      throw CompileError.at(
        node,
        `Assigning to \`${target.getText()}\` mutates the caller's object in TypeScript, but PL/pgSQL passes a composite by value — the caller would never see the change. Compute a new value and return it; marking the field \`readonly\` makes TypeScript reject this too.`,
      );
    }
    throw CompileError.at(
      node.operatorToken,
      "Assignment is not supported: a compiled function computes values with `const` and returns them.",
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

  switch (op) {
    case SyntaxKind.EqualsEqualsEqualsToken:
    case SyntaxKind.ExclamationEqualsEqualsToken: {
      if (isComposite(left.type) || isComposite(right.type)) {
        throw CompileError.at(
          node,
          "Objects compare by identity in TypeScript and by value in SQL, so `===` on an object has no faithful translation. Compare the fields you care about.",
        );
      }
      requireComparable(left.type, right.type, node);
      const negated = op === SyntaxKind.ExclamationEqualsEqualsToken;
      // TypeScript's equality is total; SQL's `=` is three-valued. When either
      // side can be null, `IS [NOT] DISTINCT FROM` is the faithful translation.
      const nullable = left.type.nullable || right.type.nullable;
      const binOp: BinOp = nullable ? (negated ? "is distinct from" : "is not distinct from") : negated ? "<>" : "=";
      return { kind: "binary", op: binOp, left, right, type: scalarType("boolean") };
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
      return {
        kind: "binary",
        op: binOp,
        left,
        right,
        type: scalarType("boolean", left.type.nullable || right.type.nullable),
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
        return { kind: "binary", op: "||", left, right, type: scalarType("text") };
      }
      return arithmetic("+", left, right, node);
    }

    case SyntaxKind.MinusToken:
      return arithmetic("-", left, right, node);
    case SyntaxKind.AsteriskToken:
      return arithmetic("*", left, right, node);

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
          "`%` is not defined for `double precision` in PostgreSQL. Annotate the operands as `Integer` or `Numeric`.",
        );
      }
      return arithmetic("%", left, right, node);
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
      return { kind: "coalesce", left, right: coerce(right, type), type: withNullable(type, right.type.nullable) };
    }

    default:
      throw CompileError.at(node.operatorToken, `Operator \`${formatSyntaxKind(op)}\` is not supported.`);
  }
}

function arithmetic(op: BinOp, left: ExprIR, right: ExprIR, node: Node): ExprIR {
  const [a, b] = numericOperands(left, right, node, op);
  return {
    kind: "binary",
    op,
    left,
    right,
    type: scalarType(widenNumeric(a.sql, b.sql), a.nullable || b.nullable),
  };
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

/* -------------------------------------------------------------------------- */
/* Type rules                                                                 */
/* -------------------------------------------------------------------------- */

export function assignable(from: PgType, to: PgType): boolean {
  if (from.nullable && !to.nullable) return false;
  return sameFamily(from, to);
}

function requireAssignable(from: PgType, to: PgType, at: Node, what: string): void {
  if (assignable(from, to)) return;
  if (from.nullable && !to.nullable) {
    throw CompileError.at(at, `The ${what} may be null; declare the type as \`T | null\` to allow it.`);
  }
  throw CompileError.at(at, `The ${what} is \`${describe(from)}\` but \`${describe(to)}\` was expected.`);
}

function requireComparable(a: PgType, b: PgType, at: Node): void {
  if (!sameFamily(a, b)) {
    throw CompileError.at(at, `Cannot compare \`${describe(a)}\` with \`${describe(b)}\`.`);
  }
}

function unify(a: PgType, b: PgType, at: Node, what: string): PgType {
  if (!sameFamily(a, b)) {
    throw CompileError.at(at, `The ${what} have incompatible types \`${describe(a)}\` and \`${describe(b)}\`.`);
  }
  if (!isScalar(a) || !isScalar(b)) return withNullable(a, a.nullable || b.nullable);

  const scalar: PgScalar = isNumeric(a) && isNumeric(b) ? widenNumeric(a.sql, b.sql) : a.sql;
  const allowed = a.allowed && b.allowed ? [...new Set([...a.allowed, ...b.allowed])] : undefined;
  return scalarType(scalar, a.nullable || b.nullable, allowed);
}

/** Widening casts are explicit in the IR so the emitter never has to guess. */
function coerce(expr: ExprIR, to: PgType): ExprIR {
  if (!isScalar(expr.type) || !isScalar(to)) return expr;
  if (expr.type.sql === to.sql) return expr;
  if (!isNumeric(expr.type) || !isNumeric(to)) return expr;
  // A whole-number literal needs no cast: PostgreSQL widens `integer` on its own.
  if (expr.kind === "lit" && typeof expr.value === "number" && Number.isInteger(expr.value)) {
    return { ...expr, type: scalarType(to.sql, false, to.allowed) };
  }
  return { kind: "cast", operand: expr, to: to.sql, type: scalarType(to.sql, expr.type.nullable) };
}

function alwaysReturns(body: readonly StmtIR[]): boolean {
  for (const statement of body) {
    if (statement.kind === "return") return true;
    if (
      statement.kind === "if" &&
      statement.orElse !== undefined &&
      statement.branches.every((b) => alwaysReturns(b.body)) &&
      alwaysReturns(statement.orElse)
    ) {
      return true;
    }
  }
  return false;
}

/* -------------------------------------------------------------------------- */
/* Node helpers                                                               */
/* -------------------------------------------------------------------------- */

function isNullLiteral(node: Expression): boolean {
  return node.kind === SyntaxKind.NullKeyword;
}

export function hasModifier(node: Node, kind: SyntaxKind): boolean {
  const modifiers = (node as { modifiers?: readonly Node[] }).modifiers;
  return modifiers?.some((m) => m.kind === kind) ?? false;
}

export function isExported(node: Node): boolean {
  return hasModifier(node, SyntaxKind.ExportKeyword);
}
