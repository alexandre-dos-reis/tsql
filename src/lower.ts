import {
  NodeFlags,
  SyntaxKind,
  formatSyntaxKind,
  type BinaryExpression,
  type Block,
  type BreakStatement,
  type CallExpression,
  type CaseClause,
  type ConditionalExpression,
  type Expression,
  type ExpressionStatement,
  type FunctionDeclaration,
  type Identifier,
  type IfStatement,
  type NewExpression,
  type Node,
  type ObjectLiteralExpression,
  type NumericLiteral,
  type ParameterDeclaration,
  type ParenthesizedExpression,
  type PropertyAccessExpression,
  type PropertyAssignment,
  type PrefixUnaryExpression,
  type ReturnStatement,
  type SpreadAssignment,
  type Statement,
  type StringLiteral,
  type SwitchStatement,
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
  type CompositeType,
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

    case SyntaxKind.SwitchStatement:
      return lowerSwitch(node as SwitchStatement, s);

    case SyntaxKind.VariableStatement:
      return lowerVariableStatement(node as VariableStatement, s);

    case SyntaxKind.BreakStatement:
      throw CompileError.at(
        node,
        (node as BreakStatement).label
          ? "Labelled `break` is not supported."
          : "`break` is only supported as the last statement of a `switch` clause.",
      );

    case SyntaxKind.ExpressionStatement: {
      // Lower it first: if it reaches for a runtime global, that is the more
      // useful error to report.
      await lowerExpr((node as ExpressionStatement).expression, s);
      throw CompileError.at(node, "This statement's value is discarded, which has no effect in a pure function.");
    }

    default:
      throw CompileError.at(
        node,
        `${formatSyntaxKind(node.kind)} is not supported. The compiled subset is: \`const\` declarations, \`if\`/\`else\`, \`switch\` and \`return\`.`,
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

/**
 * `switch` lowers to a PL/pgSQL `CASE` statement. What lowering has to prove is
 * that the `CASE` means the same thing as the TypeScript:
 *
 * - **A `default` is required.** A `CASE` with no matching `WHEN` and no `ELSE`
 *   raises `CASE_NOT_FOUND`, and TypeScript's exhaustiveness over a union does
 *   not carry over: PostgreSQL holds the value as `text`, unconstrained. With a
 *   `default` there is always an `ELSE`, so the generated function cannot raise.
 * - **Matching is `===`.** The simple form, `CASE x WHEN 'a', 'b'`, compares
 *   with `=`. A NULL discriminant matches no `WHEN` and reaches the `ELSE`, which
 *   is what `null === 'a'` does too, so a nullable discriminant is fine. What the
 *   simple form cannot express is a label that is itself NULL — `case null`, or a
 *   nullable label expression — so those switches use the searched form,
 *   `CASE WHEN x IS NULL`, with the same equality rules as an explicit `===`.
 * - **The discriminant is evaluated once**, as in JavaScript. The simple form
 *   does that natively; the searched form holds it in a local first unless it is
 *   a plain reference or literal.
 * - **Fallthrough has no `CASE` equivalent**, so a clause that has statements
 *   must end in `break`, always return, or be the last clause. Empty clauses
 *   group their labels with the next clause, which is the one fallthrough form
 *   that maps onto `WHEN a, b`.
 * - **`default` is the `ELSE`** wherever it is written, since it only runs when no
 *   label matched. Labels grouped with it keep their place in the chain, because
 *   an earlier match must still win over a later duplicate label.
 */
async function lowerSwitch(node: SwitchStatement, s: State): Promise<StmtIR[]> {
  const clauses = node.caseBlock.clauses;
  if (!clauses.some((clause) => clause.kind === SyntaxKind.DefaultClause)) {
    throw CompileError.at(
      node,
      "A `switch` needs a `default`. TypeScript may consider it exhaustive, but PostgreSQL does not constrain the value, and a `CASE` that matches nothing raises — add a `default` that handles any other value.",
    );
  }

  const subject = await lowerExpr(node.expression, s);
  if (isComposite(subject.type)) {
    throw CompileError.at(
      node.expression,
      "Objects compare by identity in TypeScript and by value in SQL, so a `switch` on an object has no faithful translation. Switch on a field instead.",
    );
  }

  // Lower every label before deciding the form: the decision depends on all of them.
  const groups: { labels: { node: Expression; value: ExprIR | null }[]; body: StmtIR[] }[] = [];
  let orElse: StmtIR[] = [];
  let labels: { node: Expression; value: ExprIR | null }[] = [];
  let hasDefault = false;

  for (const [i, clause] of clauses.entries()) {
    if (clause.kind === SyntaxKind.CaseClause) {
      const label = (clause as CaseClause).expression;
      if (isNullLiteral(label)) {
        labels.push({ node: label, value: null });
      } else {
        const value = await lowerExpr(label, s);
        checkStrictEquality(subject, value, label);
        labels.push({ node: label, value });
      }
    } else {
      hasDefault = true;
    }

    const isLast = i === clauses.length - 1;
    if (clause.statements.length === 0 && !isLast) continue;

    const body = await lowerClauseBody(clause, isLast, s);
    if (labels.length > 0) groups.push({ labels, body });
    if (hasDefault) orElse = body;
    labels = [];
    hasDefault = false;
  }

  if (groups.length === 0) return orElse;

  const simple = groups.every((g) => g.labels.every((l) => l.value !== null && !l.value.type.nullable));
  if (simple) {
    return [
      {
        kind: "simpleCase",
        subject,
        whens: groups.map((g) => ({ values: g.labels.map((l) => l.value!), body: g.body })),
        orElse,
      },
    ];
  }

  const out: StmtIR[] = [];
  let ref = subject;
  if (subject.kind !== "ref" && subject.kind !== "lit") {
    const sqlName = uniqueName("switch_value", s.used);
    s.locals.push({ tsName: sqlName, sqlName, type: subject.type });
    out.push({ kind: "assign", sqlName, expr: subject });
    ref = { kind: "ref", sqlName, type: subject.type };
  }
  const whens = groups.map((g) => ({
    cond: g.labels
      .map((l): ExprIR =>
        l.value === null
          ? { kind: "nullTest", operand: ref, negated: false, type: scalarType("boolean") }
          : strictEquality(ref, l.value, false, l.node),
      )
      .reduce((left, right): ExprIR => ({ kind: "binary", op: "or", left, right, type: scalarType("boolean") })),
    body: g.body,
  }));
  out.push({ kind: "searchedCase", whens, orElse });
  return out;
}

async function lowerClauseBody(
  clause: SwitchStatement["caseBlock"]["clauses"][number],
  isLast: boolean,
  s: State,
): Promise<StmtIR[]> {
  // `case x: { ...; break; }` is the same clause written with a block.
  const statements: readonly Statement[] =
    clause.statements.length === 1 && clause.statements[0]!.kind === SyntaxKind.Block
      ? (clause.statements[0] as Block).statements
      : clause.statements;

  const breakAt = statements.findIndex((st) => st.kind === SyntaxKind.BreakStatement);
  if (breakAt !== -1) {
    const brk = statements[breakAt] as BreakStatement;
    if (brk.label) throw CompileError.at(brk, "Labelled `break` is not supported.");
    if (breakAt !== statements.length - 1) {
      throw CompileError.at(statements[breakAt + 1]!, "Unreachable code after `break`.");
    }
    return lowerStatements(statements.slice(0, breakAt), s);
  }

  const body = await lowerStatements(statements, s);
  if (!isLast && !alwaysReturns(body)) {
    throw CompileError.at(
      clause,
      "This `switch` clause falls through into the next one, which has no PL/pgSQL equivalent. End it with `break` or `return`.",
    );
  }
  return body;
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

    case SyntaxKind.ObjectLiteralExpression:
      return lowerObjectLiteral(node as ObjectLiteralExpression, s);

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
 * A composite-typed base expression plus the field path read from it.
 *
 * Works uniformly for a parameter (`sub.plan`), a local, a nested path
 * (`nested.foo.bar`) and the result of a call (`grantSeat(seat).count`), so
 * field access does not care how the composite was produced.
 */
interface ResolvedAccess {
  readonly base: ExprIR;
  readonly path: readonly string[];
}

async function resolveAccess(node: Expression, s: State): Promise<ResolvedAccess | undefined> {
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
async function lowerAccess(node: Expression, s: State): Promise<ExprIR> {
  const resolved = await resolveAccess(node, s);
  if (resolved && isComposite(resolved.base.type) && resolved.path.length > 0) {
    return fieldOf(resolved, node);
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

/** Read one leaf from a resolved access, or explain why that path is not a value. */
function fieldOf(resolved: ResolvedAccess, at: Expression): ExprIR {
  const composite = resolved.base.type as CompositeType;
  const field = composite.fields.find((f) => samePath(f.path, resolved.path));
  if (field) {
    return { kind: "field", operand: resolved.base, sqlName: field.sqlName, type: field.type };
  }

  // A partial path names a nested shape rather than a value. After flattening
  // there is no column for the group itself.
  const leaves = composite.fields.filter((f) => startsWith(f.path, resolved.path));
  if (leaves.length > 0) {
    // Suggest leaves the way the author would write them, rooted at the same
    // variable. A call result has no variable, so the path stands alone.
    const root = rootIdentifier(at)?.text;
    throw CompileError.at(
      at,
      `\`${at.getText()}\` is a nested shape, not a value. Reference a leaf instead: ${leaves
        .map((f) => `\`${root ? `${root}.` : ""}${fieldLabel(f.path)}\``)
        .join(", ")}.`,
    );
  }
  throw CompileError.at(at, `\`${composite.tsName}\` has no field \`${fieldLabel(resolved.path)}\`.`);
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

/**
 * Build a composite value from an object literal.
 *
 * The literal needs a target type, because PostgreSQL composites are nominal
 * and `ROW(...)` has to be cast to a named one. That comes from the contextual
 * type — an annotation, the function's return type, or a parameter being passed
 * to — so an unannotated `const x = { ... }` is rejected with that advice.
 *
 * Fields are resolved by path, which is what makes spread work: `{ ...sub, plan: p }`
 * takes `plan` from `p` and every other leaf from `sub`, with later entries winning
 * exactly as they do in JavaScript.
 */
async function lowerObjectLiteral(node: ObjectLiteralExpression, s: State): Promise<ExprIR> {
  const contextual = await s.checker.getContextualType(node);
  const target = contextual ? await mapInferredType(contextual, node, s) : undefined;

  if (!target || !isComposite(target)) {
    throw CompileError.at(
      node,
      target
        ? `An object literal cannot produce \`${describe(target)}\`.`
        : "An object literal needs a named target type, because a PostgreSQL composite is nominal. Annotate it (`const next: T = { ... }`), or use it where a named type is expected.",
    );
  }

  const values = new Map<string, ExprIR>();
  for (const [sqlName, expr] of await resolveLiteral(node, target, [], s)) {
    values.set(sqlName, expr);
  }

  const args: ExprIR[] = [];
  const missing: string[] = [];
  for (const field of target.fields) {
    const value = values.get(field.sqlName);
    if (!value) {
      missing.push(fieldLabel(field.path));
      continue;
    }
    requireAssignable(value.type, field.type, node, `value for \`${fieldLabel(field.path)}\``);
    args.push(coerce(value, field.type));
  }
  if (missing.length > 0) {
    throw CompileError.at(
      node,
      `This literal is missing ${missing.map((m) => `\`${m}\``).join(", ")}. A composite has every field, so there is no way to leave one out.`,
    );
  }

  return { kind: "row", args, type: target };
}

/**
 * Walk one literal, returning `[column, expression]` pairs. Later pairs
 * override earlier ones, so processing in source order gives JavaScript's
 * own last-one-wins behaviour for spreads and duplicate keys.
 */
async function resolveLiteral(
  node: ObjectLiteralExpression,
  target: CompositeType,
  prefix: readonly string[],
  s: State,
): Promise<[string, ExprIR][]> {
  const pairs: [string, ExprIR][] = [];

  for (const property of node.properties) {
    switch (property.kind) {
      case SyntaxKind.SpreadAssignment: {
        const expression = (property as SpreadAssignment).expression;
        const source = await resolveAccess(expression, s);
        if (!source || !isComposite(source.base.type)) {
          const lowered = await lowerExpr(expression, s);
          throw CompileError.at(property, `Only an object can be spread, not \`${describe(lowered.type)}\`.`);
        }
        // `...nested` copies every leaf; `...nested.foo` copies the leaves under
        // `foo`, re-rooted at the position being spread into.
        pairs.push(...spreadPairs(source, target, prefix, property));
        break;
      }

      case SyntaxKind.PropertyAssignment:
      case SyntaxKind.ShorthandPropertyAssignment: {
        const name = property.name;
        if (name.kind !== SyntaxKind.Identifier && name.kind !== SyntaxKind.StringLiteral) {
          throw CompileError.at(name, "Computed property names are not supported.");
        }
        const key = name.kind === SyntaxKind.Identifier ? (name as Identifier).text : (name as StringLiteral).text;
        const path = [...prefix, key];
        const value =
          property.kind === SyntaxKind.PropertyAssignment
            ? (property as PropertyAssignment).initializer
            : (property.name as Identifier);

        // A nested literal keeps descending; the flattened target has no
        // column for the group itself.
        if (value.kind === SyntaxKind.ObjectLiteralExpression) {
          pairs.push(...(await resolveLiteral(value as ObjectLiteralExpression, target, path, s)));
          break;
        }

        // `{ foo: other.foo }` — splice the referenced group's leaves in.
        const group = await resolveAccess(value as Expression, s);
        if (group && isComposite(group.base.type) && !columnFor(target, path)) {
          pairs.push(...spreadPairs(group, target, path, property));
          break;
        }

        const lowered = await lowerExpr(value as Expression, s);
        const column = columnFor(target, path);
        if (!column) {
          throw CompileError.at(property, `\`${target.tsName}\` has no field \`${fieldLabel(path)}\`.`);
        }
        pairs.push([column, lowered]);
        break;
      }

      default:
        throw CompileError.at(
          property,
          `${formatSyntaxKind(property.kind)} is not supported in an object literal; use plain properties and spreads.`,
        );
    }
  }

  return pairs;
}

/**
 * Expand a resolved group into `[column, field access]` pairs, re-rooted at
 * `prefix`. Leaves the target does not have are skipped: a spread may carry
 * more than the target needs.
 */
function spreadPairs(
  source: ResolvedAccess,
  target: CompositeType,
  prefix: readonly string[],
  at: Node,
): [string, ExprIR][] {
  const composite = source.base.type as CompositeType;
  const leaves = composite.fields.filter((f) => samePath(f.path, source.path) || startsWith(f.path, source.path));
  if (leaves.length === 0) {
    throw CompileError.at(at, `\`${composite.tsName}\` has nothing at \`${fieldLabel(source.path)}\` to spread.`);
  }

  const pairs: [string, ExprIR][] = [];
  for (const field of leaves) {
    const relative = field.path.slice(source.path.length);
    const column = columnFor(target, [...prefix, ...relative]);
    if (!column) continue;
    pairs.push([column, { kind: "field", operand: source.base, sqlName: field.sqlName, type: field.type }]);
  }
  return pairs;
}

function columnFor(target: CompositeType, path: readonly string[]): string | undefined {
  return target.fields.find((f) => samePath(f.path, path))?.sqlName;
}

/** The checks `===` / `!==` make on its operands; a `switch` label makes the same ones. */
function checkStrictEquality(left: ExprIR, right: ExprIR, at: Node): void {
  if (isComposite(left.type) || isComposite(right.type)) {
    throw CompileError.at(
      at,
      "Objects compare by identity in TypeScript and by value in SQL, so `===` on an object has no faithful translation. Compare the fields you care about.",
    );
  }
  requireComparable(left.type, right.type, at);
}

/** `===` / `!==` between two lowered operands; also how a searched `switch` label matches. */
function strictEquality(left: ExprIR, right: ExprIR, negated: boolean, at: Node): ExprIR {
  checkStrictEquality(left, right, at);
  // TypeScript's equality is total; SQL's `=` is three-valued. When either
  // side can be null, `IS [NOT] DISTINCT FROM` is the faithful translation.
  const nullable = left.type.nullable || right.type.nullable;
  const binOp: BinOp = nullable ? (negated ? "is distinct from" : "is not distinct from") : negated ? "<>" : "=";
  return { kind: "binary", op: binOp, left, right, type: scalarType("boolean") };
}

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
        `Assigning to \`${target.getText()}\` mutates the caller's object in TypeScript, but PL/pgSQL passes a composite by value — the caller would never see the change. Build a new value instead (\`const next: T = { ...${rootIdentifier(target)?.text ?? "value"}, field: x }\`); marking the field \`readonly\` makes TypeScript reject the assignment too.`,
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
    // A `CASE` always has its `ELSE` (lowering requires the `default`).
    if (
      (statement.kind === "simpleCase" || statement.kind === "searchedCase") &&
      statement.whens.every((w) => alwaysReturns(w.body)) &&
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
