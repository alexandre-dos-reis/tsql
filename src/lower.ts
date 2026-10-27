import {
  NodeFlags,
  SyntaxKind,
  formatSyntaxKind,
  type ArrayLiteralExpression,
  type ArrowFunction,
  type BinaryExpression,
  type BindingElement,
  type Block,
  type BreakStatement,
  type CallExpression,
  type CaseClause,
  type ConditionalExpression,
  type Expression,
  type ExpressionStatement,
  type ForOfStatement,
  type ForStatement,
  type FunctionDeclaration,
  type Identifier,
  type IfStatement,
  type NewExpression,
  type Node,
  type ObjectLiteralExpression,
  type NumericLiteral,
  type ObjectBindingPattern,
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
  type TemplateExpression,
  type VariableDeclarationList,
  type VariableStatement,
  type WhileStatement,
} from "typescript/unstable/ast";
import { CompileError, CompileWarning } from "./errors.ts";
import {
  describe,
  arrayType,
  isArray,
  isComposite,
  isEnum,
  isExactly,
  isNumeric,
  isScalar,
  namedType,
  sameFamily,
  sameNamed,
  scalarType,
  widenNumeric,
  withNullable,
  type ArrayPart,
  type ArrayType,
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
import { INT4_MAX, INT4_MIN, isInt4 } from "./constants.ts";
import { toSnakeCase } from "./names.ts";
import { classifyReference, referenceMessage } from "./references.ts";
import {
  enumMember,
  INT_GUARD,
  isIntGuard,
  isRangeHelper,
  mapInferredType,
  mapTypeNode,
  RANGE_HELPER,
  type TypeCtx,
} from "./typemap.ts";

interface Binding {
  readonly sqlName: string;
  readonly type: PgType;
  /** Only a `let` local can be reassigned; parameters and `const`s cannot. */
  readonly kind: "param" | "const" | "let";
}

/**
 * What an unlabelled `break` or `continue` refers to, innermost last. A `break`
 * leaves the innermost loop or `switch`; a `continue` goes to the next turn of
 * the innermost loop, after running that loop's increment if it is a `for`.
 */
type Target = { readonly kind: "switch" } | { readonly kind: "loop"; readonly increment: readonly StmtIR[] };

interface State extends TypeCtx {
  readonly signatures: ReadonlyMap<string, SignatureIR>;
  readonly scope: Map<string, Binding>;
  readonly locals: LocalIR[];
  readonly used: Set<string>;
  readonly returns: PgType;
  readonly targets: Target[];
}

/* -------------------------------------------------------------------------- */
/* Signatures                                                                 */
/* -------------------------------------------------------------------------- */

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

/* -------------------------------------------------------------------------- */
/* Bodies                                                                     */
/* -------------------------------------------------------------------------- */

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
  };
}

async function lowerReturn(expr: Expression, s: State): Promise<StmtIR> {
  const value = await lowerExpr(expr, s, s.returns);
  requireAssignable(value.type, s.returns, expr, "return value");
  return { kind: "return", expr: coerce(value, s.returns) };
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
      return [await lowerReturn(expr, s)];
    }

    case SyntaxKind.IfStatement:
      return [await lowerIf(node as IfStatement, s)];

    case SyntaxKind.SwitchStatement:
      return lowerSwitch(node as SwitchStatement, s);

    case SyntaxKind.VariableStatement:
      return lowerVariableStatement(node as VariableStatement, s);

    case SyntaxKind.BreakStatement: {
      if ((node as BreakStatement).label) throw CompileError.at(node, "Labelled `break` is not supported.");
      const target = s.targets.at(-1);
      if (target?.kind === "loop") return [{ kind: "exit" }];
      throw CompileError.at(
        node,
        target
          ? "`break` is only supported as the last statement of a `switch` clause."
          : "`break` is only supported inside a loop, or as the last statement of a `switch` clause.",
      );
    }

    case SyntaxKind.ContinueStatement: {
      if ((node as { label?: unknown }).label) throw CompileError.at(node, "Labelled `continue` is not supported.");
      let loop: Target | undefined;
      for (const target of s.targets) if (target.kind === "loop") loop = target;
      if (!loop || loop.kind !== "loop") throw CompileError.at(node, "`continue` is only supported inside a loop.");
      // A `for` loop's increment runs before the next turn; PL/pgSQL's CONTINUE
      // would skip it, so it is emitted first.
      return [...loop.increment, { kind: "continue" }];
    }

    case SyntaxKind.WhileStatement:
      return [await lowerWhile(node as WhileStatement, s)];

    case SyntaxKind.ForStatement:
      return lowerFor(node as ForStatement, s);

    case SyntaxKind.DoStatement:
      throw CompileError.at(node, "`do … while` is not supported; write it as a `while` loop.");

    case SyntaxKind.ForOfStatement:
      return [await lowerForOf(node as ForOfStatement, s)];

    case SyntaxKind.ForInStatement:
      throw CompileError.at(
        node,
        "`for … in` is not supported: an object's keys are fixed by its type, and a composite has no key to iterate.",
      );

    case SyntaxKind.ExpressionStatement: {
      const expression = (node as ExpressionStatement).expression;
      const assignment = await lowerAssignment(expression, s);
      if (assignment) return [assignment];
      // Lower it first: if it reaches for a runtime global, that is the more
      // useful error to report.
      await lowerExpr(expression, s);
      throw CompileError.at(node, "This statement's value is discarded, which has no effect in a pure function.");
    }

    default:
      throw CompileError.at(
        node,
        `${formatSyntaxKind(node.kind)} is not supported. The compiled subset is: \`const\` and \`let\` declarations, assignments, \`if\`/\`else\`, \`switch\`, \`while\`, \`for\`, \`for … of\` and \`return\`.`,
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
 * - **When every branch only returns a value**, the whole `switch` becomes
 *   `RETURN CASE … END`: the expression form, with the same matching rules. SQL's
 *   expression takes one value per `WHEN`, so grouped labels each get their own
 *   `WHEN` with the same result — a pure expression, of which only one runs.
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
  if (isComposite(subject.type) || isArray(subject.type)) {
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
  const elseValue = returnedValue(orElse);
  const allReturn = elseValue !== undefined && groups.every((g) => returnedValue(g.body) !== undefined);

  // A label compared to an enum subject as text makes every comparison text.
  let subjectExpr = subject;
  if (
    simple &&
    groups.some((g) => g.labels.some((l) => l.value!.kind !== "lit" && !sameNamed(subject.type, l.value!.type)))
  ) {
    subjectExpr = textOf(subject);
    for (const g of groups) for (const l of g.labels) l.value = textOf(l.value!);
  }

  if (simple && allReturn) {
    const whens = groups.flatMap((g) => g.labels.map((l) => ({ value: l.value!, result: returnedValue(g.body)! })));
    return [
      {
        kind: "return",
        expr: { kind: "simpleCaseExpr", subject: subjectExpr, whens, orElse: elseValue, type: s.returns },
      },
    ];
  }
  if (simple) {
    return [
      {
        kind: "simpleCase",
        subject: subjectExpr,
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
  if (allReturn) {
    const exprWhens = whens.map((w) => ({ cond: w.cond, result: returnedValue(w.body)! }));
    out.push({
      kind: "return",
      expr: { kind: "searchedCaseExpr", whens: exprWhens, orElse: elseValue, type: s.returns },
    });
    return out;
  }
  out.push({ kind: "searchedCase", whens, orElse });
  return out;
}

/** The value of a branch that does nothing but `return value`, already coerced to the return type. */
function returnedValue(body: readonly StmtIR[]): ExprIR | undefined {
  const [only] = body;
  return body.length === 1 && only!.kind === "return" ? only!.expr : undefined;
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
    return within(s, { kind: "switch" }, () => lowerStatements(statements.slice(0, breakAt), s));
  }

  const body = await within(s, { kind: "switch" }, () => lowerStatements(statements, s));
  if (!isLast && !alwaysReturns(body)) {
    throw CompileError.at(
      clause,
      "This `switch` clause falls through into the next one, which has no PL/pgSQL equivalent. End it with `break` or `return`.",
    );
  }
  return body;
}

/** Lower `body` with `target` as what `break` and `continue` refer to. */
async function within<T>(s: State, target: Target, body: () => Promise<T>): Promise<T> {
  s.targets.push(target);
  try {
    return await body();
  } finally {
    s.targets.pop();
  }
}

/**
 * Names declared inside a loop — its `for (let i …)` variable, a `const` in its
 * body — are block-scoped in TypeScript, so the next loop may declare them again.
 * They keep their (unique) SQL variable; only the TypeScript name is released.
 */
async function scoped<T>(s: State, body: () => Promise<T>): Promise<T> {
  const before = new Set(s.scope.keys());
  try {
    return await body();
  } finally {
    for (const name of [...s.scope.keys()]) if (!before.has(name)) s.scope.delete(name);
  }
}

/** Like an `if` condition: a boolean. NULL stops a `WHILE` as `false` stops a TypeScript loop. */
function loopCondition(expression: Expression, cond: ExprIR, what: string): ExprIR {
  if (!isExactly(cond.type, "boolean")) {
    throw CompileError.at(
      expression,
      `A \`${what}\` condition must be a boolean, not \`${describe(cond.type)}\`. Truthiness is not translated — compare explicitly.`,
    );
  }
  return cond;
}

/**
 * `while (cond) { … }` is `WHILE cond LOOP … END LOOP;`. The condition is
 * re-evaluated before each turn in both languages.
 */
async function lowerWhile(node: WhileStatement, s: State): Promise<StmtIR> {
  const cond = loopCondition(node.expression, await lowerExpr(node.expression, s), "while");
  const body = await scoped(s, () =>
    within(s, { kind: "loop", increment: [] }, () => lowerStatements(asStatements(node.statement), s)),
  );
  return { kind: "while", cond, body };
}

/**
 * `for (init; cond; step) { … }` is `init; WHILE cond LOOP …; step; END LOOP;`.
 *
 * Not PL/pgSQL's `FOR i IN a..b`: that evaluates its bounds once and forbids
 * assigning to `i`, while a TypeScript `for` re-tests its condition every turn
 * and lets the body change anything. `WHILE` keeps the TypeScript semantics
 * exactly. A `continue` runs `step` before jumping, as TypeScript does.
 */
async function lowerFor(node: ForStatement, s: State): Promise<StmtIR[]> {
  return scoped(s, async () => {
    const out: StmtIR[] = [];
    const init = node.initializer;
    if (init) {
      if (init.kind === SyntaxKind.VariableDeclarationList) {
        out.push(...(await lowerDeclarationList(init as VariableDeclarationList, init, s)));
      } else {
        const assignment = await lowerAssignment(init as Expression, s);
        if (!assignment) throw CompileError.at(init, "A `for` initialiser must declare or assign a variable.");
        out.push(assignment);
      }
    }

    const cond: ExprIR = node.condition
      ? loopCondition(node.condition, await lowerExpr(node.condition, s), "for")
      : { kind: "lit", value: true, type: scalarType("boolean") };

    const increment: StmtIR[] = [];
    if (node.incrementor) {
      const step = await lowerAssignment(node.incrementor, s, countedAdvice(node));
      if (!step) throw CompileError.at(node.incrementor, "A `for` step must assign a variable (`i++`, `i += 2`).");
      increment.push(step);
      await adviseRange(node, s);
    }

    const body = await within(s, { kind: "loop", increment }, () => lowerStatements(asStatements(node.statement), s));
    out.push({ kind: "while", cond, body: [...body, ...increment] });
    return out;
  });
}

/**
 * `for (const x of xs) { … }` is `FOREACH x IN ARRAY xs LOOP … END LOOP;`.
 *
 * Both evaluate the array once and visit its elements in order, and the array
 * is read-only (a `readonly T[]` parameter), so the body cannot change what is
 * being iterated. `break` and `continue` are `EXIT` and `CONTINUE`, as in any
 * loop. The variable is a local of the element type, scoped to the loop.
 */
async function lowerForOf(node: ForOfStatement, s: State): Promise<StmtIR> {
  if (node.awaitModifier) {
    throw CompileError.at(
      node,
      "`for await` is not supported: a PL/pgSQL function runs to completion with nothing to await.",
    );
  }
  const init = node.initializer;
  if (init.kind !== SyntaxKind.VariableDeclarationList) {
    throw CompileError.at(init, "Declare the loop variable in the loop: `for (const x of xs)`.");
  }
  const list = init as VariableDeclarationList;
  const kind = list.flags & NodeFlags.Const ? "const" : list.flags & NodeFlags.Let ? "let" : undefined;
  if (!kind) {
    throw CompileError.at(init, "`var` is not supported: it is function-scoped and hoisted. Use `const`.");
  }
  const declaration = list.declarations[0]!;
  if (declaration.name.kind !== SyntaxKind.Identifier) {
    throw CompileError.at(
      declaration.name,
      "Destructuring the loop variable is not supported; destructure inside the body: `for (const todo of todos) { const { done } = todo; … }`.",
    );
  }
  const tsName = (declaration.name as Identifier).text;

  if (await isRangeCall(node.expression, s)) {
    return lowerForRange(node, node.expression as CallExpression, tsName, kind, declaration.name, s);
  }

  const array = await lowerExpr(node.expression, s);
  if (!isArray(array.type)) {
    throw CompileError.at(
      node.expression,
      isExactly(array.type, "text")
        ? "`for … of` over a string is not supported: it iterates code points, which SQL has no loop for."
        : `\`for … of\` iterates an array, and \`${node.expression.getText()}\` is \`${describe(array.type)}\`.`,
    );
  }
  const element = array.type.element;

  return scoped(s, async () => {
    if (s.scope.has(tsName)) {
      throw CompileError.at(declaration.name, `\`${tsName}\` shadows an existing binding.`);
    }
    const sqlName = uniqueName(toSnakeCase(tsName), s.used);
    s.scope.set(tsName, { sqlName, type: element, kind });
    s.locals.push({ tsName, sqlName, type: element });
    const body = await within(s, { kind: "loop", increment: [] }, () =>
      lowerStatements(asStatements(node.statement), s),
    );
    return { kind: "foreach", variable: sqlName, array, body };
  });
}

/**
 * `for (let i = A; i <= B; i++)` — the counted shape, read purely syntactically.
 *
 * Only used to write a better refusal. When the step is an `integer` it has
 * nowhere to put a guard, and the useful answer is not "guard it" but "this is
 * a counted loop, and there is a counted loop" — so the message names the exact
 * `range(...)` that replaces it, with the bounds the author actually wrote.
 *
 * A strict `<` has no inclusive upper bound of its own, so the suggestion
 * carries the `- 1`, guarded, which is what makes it compile.
 */
function countedShape(node: ForStatement): CountedShape | undefined {
  const init = node.initializer;
  if (!init || init.kind !== SyntaxKind.VariableDeclarationList) return undefined;
  const declarations = (init as VariableDeclarationList).declarations;
  const declaration = declarations.length === 1 ? declarations[0] : undefined;
  if (!declaration || declaration.name.kind !== SyntaxKind.Identifier || !declaration.initializer) return undefined;
  const name = (declaration.name as Identifier).text;

  if (!node.condition || node.condition.kind !== SyntaxKind.BinaryExpression) return undefined;
  const condition = node.condition as BinaryExpression;
  const comparison = condition.operatorToken.kind;
  if (comparison !== SyntaxKind.LessThanToken && comparison !== SyntaxKind.LessThanEqualsToken) return undefined;
  if (condition.left.kind !== SyntaxKind.Identifier || (condition.left as Identifier).text !== name) return undefined;

  const from = declaration.initializer.getText();
  const bound = condition.right;
  const inclusive = comparison === SyntaxKind.LessThanEqualsToken;
  // `i < 10` is `0..9`, folded here rather than suggesting `int(10 - 1)`, which
  // would be advice nobody would take.
  const literal = bound.kind === SyntaxKind.NumericLiteral ? Number((bound as NumericLiteral).text) : undefined;
  const to = inclusive
    ? bound.getText()
    : literal !== undefined && Number.isInteger(literal)
      ? String(literal - 1)
      : `${INT_GUARD}(${bound.getText()} - 1)`;
  const sql = inclusive ? bound.getText() : literal !== undefined && Number.isInteger(literal) ? String(literal - 1) : `${bound.getText()} - 1`;
  return { name, call: `for (const ${name} of ${RANGE_HELPER}(${from}, ${to}))`, sql: `FOR ${name} IN ${from}..${sql}` };
}

interface CountedShape {
  readonly name: string;
  /** The `for … of` that replaces it, with the bounds the author wrote. */
  readonly call: string;
  /** The PL/pgSQL it becomes, named so the advice shows what is gained. */
  readonly sql: string;
}

/**
 * A counted loop that already guards its step is correct, and could be shorter.
 *
 * Nothing is wrong with `i = int(i + 1)` — it is what the refusal of `i++` asks
 * for — so this is advice, not a refusal: the loop compiles either way. It is
 * only raised because there is a concrete rewrite to name; the compiler does
 * not warn about things the author cannot improve.
 */
async function adviseRange(node: ForStatement, s: State): Promise<void> {
  const shape = countedShape(node);
  if (!shape || !node.incrementor) return;
  if ((await guardedStepByOne(node.incrementor, s)) !== shape.name) return;
  // A `Float` counter has no `range`, and no overflow to guard against either.
  const binding = s.scope.get(shape.name);
  if (!binding || !isExactly(binding.type, "integer")) return;
  s.warnings.push(
    CompileWarning.at(
      node.incrementor,
      `warning: this counted loop can be \`${shape.call}\`, which becomes PostgreSQL's own \`${shape.sql}\` — ` +
        `its counter stops at the bound, so the step needs no \`${INT_GUARD}(...)\` guard. Compiles as written either way.`,
    ),
  );
}

/** The advice carried by a refusal of the step. */
function countedAdvice(node: ForStatement): string | undefined {
  const shape = countedShape(node);
  if (!shape || !node.incrementor || stepsByOne(node.incrementor) !== shape.name) return undefined;
  return (
    `This is a counted loop, so write it as \`${shape.call}\` — ` +
    `that becomes PostgreSQL's own \`${shape.sql}\`, whose counter stops at the bound and so needs no guard. `
  );
}

/**
 * `i = int(i + 1)` — the step that compiles, and the one worth advising about.
 *
 * The author has already done the work the refusal would have asked for, so
 * there is nothing to refuse; there is only a better loop to point at. This is
 * the only accepted construct the compiler currently has advice for.
 */
async function guardedStepByOne(expression: Expression, s: State): Promise<string | undefined> {
  if (expression.kind !== SyntaxKind.BinaryExpression) return undefined;
  const assignment = expression as BinaryExpression;
  if (assignment.operatorToken.kind !== SyntaxKind.EqualsToken) return undefined;
  if (assignment.left.kind !== SyntaxKind.Identifier) return undefined;
  const name = (assignment.left as Identifier).text;
  if (assignment.right.kind !== SyntaxKind.CallExpression) return undefined;
  const call = assignment.right as CallExpression;
  if (call.expression.kind !== SyntaxKind.Identifier || !(await isIntGuard(call.expression, s))) return undefined;
  const [argument, ...rest] = call.arguments;
  if (!argument || rest.length > 0 || argument.kind !== SyntaxKind.BinaryExpression) return undefined;
  const sum = argument as BinaryExpression;
  if (sum.operatorToken.kind !== SyntaxKind.PlusToken) return undefined;
  if (sum.left.kind !== SyntaxKind.Identifier || (sum.left as Identifier).text !== name) return undefined;
  if (sum.right.kind !== SyntaxKind.NumericLiteral || (sum.right as NumericLiteral).text !== "1") return undefined;
  return name;
}

/** `i++`, `++i` or `i += 1` — the variable it steps, if it steps by one. */
function stepsByOne(expression: Expression): string | undefined {
  if (expression.kind === SyntaxKind.PostfixUnaryExpression || expression.kind === SyntaxKind.PrefixUnaryExpression) {
    const unary = expression as unknown as { readonly operator: SyntaxKind; readonly operand: Expression };
    if (unary.operator !== SyntaxKind.PlusPlusToken) return undefined;
    return unary.operand.kind === SyntaxKind.Identifier ? (unary.operand as Identifier).text : undefined;
  }
  if (expression.kind === SyntaxKind.BinaryExpression) {
    const binary = expression as BinaryExpression;
    if (binary.operatorToken.kind !== SyntaxKind.PlusEqualsToken) return undefined;
    if (binary.left.kind !== SyntaxKind.Identifier) return undefined;
    if (binary.right.kind !== SyntaxKind.NumericLiteral || (binary.right as NumericLiteral).text !== "1") return undefined;
    return (binary.left as Identifier).text;
  }
  return undefined;
}

/** Is this `for … of` iterating `range(a, b)` rather than an array? */
async function isRangeCall(expression: Expression, s: State): Promise<boolean> {
  if (expression.kind !== SyntaxKind.CallExpression) return false;
  const callee = (expression as CallExpression).expression;
  return callee.kind === SyntaxKind.Identifier && (await isRangeHelper(callee, s));
}

/**
 * `for (const i of range(a, b))` is `FOR i IN a..b LOOP … END LOOP;`.
 *
 * The one counted loop the compiler accepts without a guard on its step, and it
 * is PostgreSQL's own: both bounds are evaluated once and the counter stops at
 * the upper one, so it cannot leave 32 bits however large that bound is. A
 * hand-written `i++` carries no such proof, which is why it is refused.
 *
 * `const` is required. PL/pgSQL's loop variable belongs to the loop, and making
 * the TypeScript one reassignable would describe something the SQL does not do;
 * `const` also means `tsc` refuses the reassignment, so the correspondence is
 * checked rather than trusted.
 */
async function lowerForRange(
  node: ForOfStatement,
  call: CallExpression,
  tsName: string,
  kind: "const" | "let",
  at: Node,
  s: State,
): Promise<StmtIR> {
  if (kind !== "const") {
    throw CompileError.at(
      at,
      `\`${tsName}\` must be \`const\`: PL/pgSQL's \`FOR\` variable belongs to its loop, so a reassignable one would promise something the SQL does not do.`,
    );
  }
  const [a, b, ...rest] = call.arguments;
  if (!a || !b || rest.length > 0) {
    throw CompileError.at(call, `\`${RANGE_HELPER}\` takes exactly two bounds, got ${call.arguments.length}.`);
  }

  const integer = scalarType("integer");
  const bounds: ExprIR[] = [];
  for (const [i, argument] of [a, b].entries()) {
    const lowered = await lowerExpr(argument as Expression, s, integer);
    requireAssignable(lowered.type, integer, argument as Node, `${i === 0 ? "lower" : "upper"} bound of \`${RANGE_HELPER}\``);
    bounds.push(coerce(lowered, integer));
  }

  return scoped(s, async () => {
    if (s.scope.has(tsName)) {
      throw CompileError.at(at, `\`${tsName}\` shadows an existing binding.`);
    }
    // No local: PL/pgSQL declares the loop variable itself, as an `integer`
    // scoped to the loop, and declaring it again would only shadow that.
    const sqlName = uniqueName(toSnakeCase(tsName), s.used);
    s.scope.set(tsName, { sqlName, type: integer, kind });
    const body = await within(s, { kind: "loop", increment: [] }, () =>
      lowerStatements(asStatements(node.statement), s),
    );
    return { kind: "forRange", variable: sqlName, from: bounds[0]!, to: bounds[1]!, body };
  });
}

function asStatements(node: Statement): readonly Statement[] {
  return node.kind === SyntaxKind.Block ? (node as Block).statements : [node];
}

async function lowerVariableStatement(node: VariableStatement, s: State): Promise<StmtIR[]> {
  return lowerDeclarationList(node.declarationList, node, s);
}

async function lowerDeclarationList(list: VariableDeclarationList, node: Node, s: State): Promise<StmtIR[]> {
  const flags = list.flags;
  const kind = flags & NodeFlags.Const ? "const" : flags & NodeFlags.Let ? "let" : undefined;
  if (!kind) {
    throw CompileError.at(
      node,
      "`var` is not supported: it is function-scoped and hoisted. Use `const`, or `let` for a value that changes.",
    );
  }

  const out: StmtIR[] = [];
  for (const declaration of list.declarations) {
    if (declaration.name.kind === SyntaxKind.ObjectBindingPattern) {
      out.push(...(await lowerDestructuring(declaration.name as ObjectBindingPattern, declaration, kind, s)));
      continue;
    }
    if (declaration.name.kind !== SyntaxKind.Identifier) {
      throw CompileError.at(
        declaration.name,
        "Array destructuring is not supported: reading by position is not part of the compiled subset. Iterate with `for (const x of xs)`.",
      );
    }
    const tsName = (declaration.name as Identifier).text;
    if (!declaration.initializer) {
      throw CompileError.at(declaration, `\`${tsName}\` must be initialised.`);
    }
    if (s.scope.has(tsName)) {
      throw CompileError.at(declaration.name, `\`${tsName}\` shadows an existing binding.`);
    }

    // Without an annotation, a `let` takes the type of its initial value, like a
    // `const`. TypeScript widens `let total = 0` to `number`; here it is an
    // `integer`, and assigning it 0.5 later is refused with a hint to annotate —
    // never silently rounded.
    const annotated = declaration.type ? await mapTypeNode(declaration.type, s) : undefined;
    const init = await lowerExpr(declaration.initializer, s, annotated);
    const declared = annotated ?? (await inferLocalType(init, declaration.initializer, s));
    requireAssignable(init.type, declared, declaration.initializer, `initialiser for \`${tsName}\``);

    const sqlName = uniqueName(toSnakeCase(tsName), s.used);
    s.scope.set(tsName, { sqlName, type: declared, kind });
    s.locals.push({ tsName, sqlName, type: declared });
    out.push({ kind: "assign", sqlName, expr: coerce(init, declared) });
  }
  return out;
}

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
async function lowerAssignment(expression: Expression, s: State, advice?: string): Promise<StmtIR | undefined> {
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
              (advice ?? "") +
              `${advice ? "Otherwise, write" : "Write"} the assignment out and guard it: \`${(target as Identifier).text} = ${INT_GUARD}(${(target as Identifier).text} ${binary.operatorToken.getText().slice(0, -1)} ${binary.right.getText()})\`.`,
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
            (advice ?? "") +
            `${advice ? "Otherwise, write" : "Write"} it out and guard it: \`${text} = ${INT_GUARD}(${text} ${op === SyntaxKind.PlusToken ? "+" : "-"} 1)\`.`,
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

/**
 * `const { plan, count } = sub;` is `const plan = sub.plan; const count = sub.count;`
 * — field reads the compiler already does, one local per name. Nested patterns
 * read nested fields (`const { customer: { tier } } = basket` reads
 * `basket.customer.tier`), and `{ plan: p }` renames.
 *
 * The source is read once, as in JavaScript: a call or an object literal is held
 * in a local first. Defaults and `...rest` are refused — a default would need a
 * check for `undefined`, which has no SQL equivalent, and a rest object has no
 * named composite type to become.
 */
async function lowerDestructuring(
  pattern: ObjectBindingPattern,
  declaration: VariableStatement["declarationList"]["declarations"][number],
  kind: "const" | "let",
  s: State,
): Promise<StmtIR[]> {
  if (!declaration.initializer) throw CompileError.at(declaration, "A destructuring must be initialised.");
  if (declaration.type) {
    throw CompileError.at(
      declaration.type,
      "A type annotation on a destructuring is not supported; annotate the object being destructured instead.",
    );
  }

  const resolved = await resolveAccess(declaration.initializer, s);
  if (!resolved || !isComposite(resolved.base.type)) {
    throw CompileError.at(
      declaration.initializer,
      `Only an object of a named type can be destructured; \`${declaration.initializer.getText()}\` is not one.`,
    );
  }

  const out: StmtIR[] = [];
  let base = resolved.base;
  if (base.kind !== "ref") {
    const sqlName = uniqueName("destructured", s.used);
    s.locals.push({ tsName: sqlName, sqlName, type: base.type });
    out.push({ kind: "assign", sqlName, expr: base });
    base = { kind: "ref", sqlName, type: base.type };
  }

  const bind = async (elements: readonly BindingElement[], prefix: readonly string[]): Promise<void> => {
    for (const element of elements) {
      if (element.dotDotDotToken) {
        throw CompileError.at(element, "`...rest` in a destructuring is not supported: the rest has no named type.");
      }
      if (element.initializer) {
        throw CompileError.at(
          element.initializer,
          "Default values in a destructuring are not supported: they apply on `undefined`, which has no SQL equivalent.",
        );
      }
      const name = element.name;
      if (!name) throw CompileError.at(element, "Only plain property names can be destructured.");
      const key = element.propertyName ?? name;
      if (key.kind !== SyntaxKind.Identifier) {
        throw CompileError.at(key, "Only plain property names can be destructured.");
      }
      const path = [...prefix, (key as Identifier).text];

      if (name.kind === SyntaxKind.ObjectBindingPattern) {
        await bind((name as ObjectBindingPattern).elements, path);
        continue;
      }
      if (name.kind !== SyntaxKind.Identifier) {
        throw CompileError.at(
          name,
          "Array destructuring is not supported: reading by position is not part of the compiled subset.",
        );
      }

      const field = readPath(base, path, element);

      const tsName = (name as Identifier).text;
      if (s.scope.has(tsName)) {
        throw CompileError.at(name, `\`${tsName}\` shadows an existing binding.`);
      }
      const sqlName = uniqueName(toSnakeCase(tsName), s.used);
      s.scope.set(tsName, { sqlName, type: field.type, kind });
      s.locals.push({ tsName, sqlName, type: field.type });
      out.push({ kind: "assign", sqlName, expr: field });
    }
  };

  await bind(pattern.elements, resolved.path);
  return out;
}

/**
 * A `const` without an annotation takes the type the expression produced.
 * The checker is consulted too, so that an annotation-free `const` whose
 * TypeScript type we could not represent is still rejected with a good message.
 */
async function inferLocalType(init: ExprIR, at: Expression, s: State): Promise<PgType> {
  // An array's type is the one lowering built. The checker would see `[1, 2]`
  // as a mutable `number[]`, which is harmless in a local: every way to mutate
  // it — a method, an element or a `length` assignment — is refused anyway.
  if (isArray(init.type)) return init.type;
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
async function lowerExpr(node: Expression, s: State, expected?: PgType, guarded = false): Promise<ExprIR> {
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
      return lowerCall(node as CallExpression, s);

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

async function lowerCall(node: CallExpression, s: State): Promise<ExprIR> {
  if (node.expression.kind === SyntaxKind.PropertyAccessExpression) {
    const access = node.expression as PropertyAccessExpression;
    const array = await arrayOperand(access.expression, s);
    if (array) return lowerArrayMethod(node, access, array, s);
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
  if (await isRangeHelper(node.expression, s)) {
    throw CompileError.at(
      node,
      `\`${RANGE_HELPER}\` is only the iterable of a \`for … of\` (\`for (const i of ${RANGE_HELPER}(a, b))\`), which becomes PostgreSQL's \`FOR i IN a..b\`. A sequence is not a value PostgreSQL can hold, so it cannot be stored, passed or returned.`,
    );
  }
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
async function lowerArrayLiteral(node: ArrayLiteralExpression, s: State, expected?: PgType): Promise<ExprIR> {
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
async function arrayOperand(node: Expression, s: State): Promise<(ExprIR & { readonly type: ArrayType }) | undefined> {
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

const ARRAY_SUBSET = "On an array, the compiled subset is `.length`, `.includes(value)` and `for … of`.";

/**
 * `xs.includes(value)` on scalar elements, as `array_position(xs, value) IS NOT NULL`.
 *
 * `includes` compares with SameValueZero, and `array_position` with
 * `IS NOT DISTINCT FROM`, so both find a NULL and both treat NaN as equal to
 * itself. On objects, `includes` compares identity, which SQL cannot see.
 */
async function lowerArrayMethod(
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
  const operand = (node as PropertyAccessExpression).expression;
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
function tryReadPath(base: ExprIR, path: readonly string[]): ExprIR | undefined {
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
function readPath(base: ExprIR, path: readonly string[], at: Node): ExprIR {
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

/** `+=`, `-=`, `*=` lower to the operators that can overflow; `/=` and `%=` cannot. */
const COMPOUND_OVERFLOWS = new Set<SyntaxKind>([SyntaxKind.PlusToken, SyntaxKind.MinusToken, SyntaxKind.AsteriskToken]);

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
 * Fields are matched by name, in source order, so a later entry wins exactly as
 * in JavaScript: `{ ...sub, plan: p }` takes `plan` from `p` and every other
 * field from `sub`. A field of an object type takes a value of that type — a
 * nested literal, a field read off another object, a call — so
 * `{ ...basket, customer: { ...basket.customer, tier: "gold" } }` builds a `ROW`
 * inside a `ROW`.
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
  for (const property of node.properties) {
    switch (property.kind) {
      case SyntaxKind.SpreadAssignment: {
        const source = await lowerExpr((property as SpreadAssignment).expression, s);
        if (!isComposite(source.type)) {
          throw CompileError.at(property, `Only an object can be spread, not \`${describe(source.type)}\`.`);
        }
        // A spread may carry more than the target has; those fields are dropped.
        for (const field of source.type.fields) {
          if (!target.fields.some((f) => f.tsName === field.tsName)) continue;
          values.set(field.tsName, { kind: "field", operand: source, sqlName: field.sqlName, type: field.type });
        }
        break;
      }

      case SyntaxKind.PropertyAssignment:
      case SyntaxKind.ShorthandPropertyAssignment: {
        const name = property.name;
        if (name.kind !== SyntaxKind.Identifier && name.kind !== SyntaxKind.StringLiteral) {
          throw CompileError.at(name, "Computed property names are not supported.");
        }
        const key = name.kind === SyntaxKind.Identifier ? (name as Identifier).text : (name as StringLiteral).text;
        const field = target.fields.find((f) => f.tsName === key);
        if (!field) throw CompileError.at(property, `\`${target.tsName}\` has no field \`${key}\`.`);
        const value =
          property.kind === SyntaxKind.PropertyAssignment
            ? (property as PropertyAssignment).initializer
            : (property.name as Identifier);
        values.set(key, await lowerExpr(value as Expression, s, field.type));
        break;
      }

      default:
        throw CompileError.at(
          property,
          `${formatSyntaxKind(property.kind)} is not supported in an object literal; use plain properties and spreads.`,
        );
    }
  }

  const args: ExprIR[] = [];
  const missing: string[] = [];
  for (const field of target.fields) {
    const value = values.get(field.tsName);
    if (!value) {
      missing.push(field.tsName);
      continue;
    }
    requireAssignable(value.type, field.type, node, `value for \`${field.tsName}\``);
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

/** The checks `===` / `!==` make on its operands; a `switch` label makes the same ones. */
function checkStrictEquality(left: ExprIR, right: ExprIR, at: Node): void {
  if (isArray(left.type) || isArray(right.type)) {
    throw CompileError.at(
      at,
      "Arrays compare by identity in TypeScript and by value in SQL, so `===` on an array has no faithful translation.",
    );
  }
  if (isComposite(left.type) || isComposite(right.type)) {
    throw CompileError.at(
      at,
      "Objects compare by identity in TypeScript and by value in SQL, so `===` on an object has no faithful translation. Compare the fields you care about.",
    );
  }
  requireComparable(left.type, right.type, at);
}

/**
 * Two operands made comparable in SQL. An enum is a type of its own: equal to
 * itself or to a literal, which takes its type, but compared as `text` with
 * anything else — a plain string, a domain, another enum. TypeScript compares
 * the strings either way, so comparing the text is the faithful translation.
 */
function comparable(left: ExprIR, right: ExprIR): [ExprIR, ExprIR] {
  // A plain string literal is untyped in SQL, so it takes the other side's type.
  const untyped = (e: ExprIR) => e.kind === "lit" && !isEnum(e.type);
  if (sameNamed(left.type, right.type) || untyped(left) || untyped(right)) return [left, right];
  return [textOf(left), textOf(right)];
}

/** An enum value as `text`; anything else as it is (a domain is text already). */
function textOf(expr: ExprIR): ExprIR {
  if (!isEnum(expr.type)) return expr;
  const type = scalarType("text", expr.type.nullable);
  return expr.kind === "lit" ? { ...expr, type } : { kind: "cast", operand: expr, to: "text", type };
}

/** `===` / `!==` between two lowered operands; also how a searched `switch` label matches. */
function strictEquality(leftOperand: ExprIR, rightOperand: ExprIR, negated: boolean, at: Node): ExprIR {
  checkStrictEquality(leftOperand, rightOperand, at);
  const [left, right] = comparable(leftOperand, rightOperand);
  // TypeScript's equality is total; SQL's `=` is three-valued. When either
  // side can be null, `IS [NOT] DISTINCT FROM` is the faithful translation.
  const nullable = left.type.nullable || right.type.nullable;
  const binOp: BinOp = nullable ? (negated ? "is distinct from" : "is not distinct from") : negated ? "<>" : "=";
  return { kind: "binary", op: binOp, left, right, type: scalarType("boolean") };
}

async function lowerBinary(node: BinaryExpression, s: State, guarded = false): Promise<ExprIR> {
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
function combine(op: SyntaxKind, left: ExprIR, right: ExprIR, node: BinaryExpression, guarded = false): ExprIR {
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

function arithmetic(op: BinOp, left: ExprIR, right: ExprIR, node: Node, guarded = false): ExprIR {
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
function unguarded(op: string, what: string, node: Node): CompileError {
  return CompileError.at(
    node,
    `${what} \`${op}\` can overflow 32 bits, which PostgreSQL refuses (\`integer out of range\`) where TypeScript keeps counting in doubles. ` +
      `Wrap it in \`${INT_GUARD}(...)\` (\`import { ${INT_GUARD} } from "@adr/tsql"\`) so both sides raise — one guard per operation, so \`${INT_GUARD}(a + ${INT_GUARD}(b * c))\` — ` +
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

/* -------------------------------------------------------------------------- */
/* Type rules                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Can a value of `from` be stored where `to` is expected? Numbers may only
 * widen (`integer` → `numeric` → `double precision`). Narrowing is refused:
 * TypeScript keeps the double it computed, while PostgreSQL would silently
 * round it on assignment — `return x` with `x = 2.5` into `RETURNS integer`
 * gives 2.5 in one language and 2 in the other.
 */
export function assignable(from: PgType, to: PgType): boolean {
  if (from.nullable && !to.nullable) return false;
  if (isArray(from) || isArray(to)) {
    if (!isArray(from) || !isArray(to)) return false;
    // An array of nullable elements cannot stand in for one whose elements are not.
    if (from.element.nullable && !to.element.nullable) return false;
    // Numeric elements widen as numbers do, by an array cast.
    const [a, b] = [from.element, to.element];
    if (isScalar(a) && isScalar(b) && isNumeric(a) && isNumeric(b)) return widenNumeric(a.sql, b.sql) === b.sql;
    return sameFamily(from, to);
  }
  if (isNumeric(from) && isNumeric(to) && isScalar(from) && isScalar(to)) {
    return widenNumeric(from.sql, to.sql) === to.sql;
  }
  return sameFamily(from, to);
}

function requireAssignable(from: PgType, to: PgType, at: Node, what: string): void {
  if (assignable(from, to)) return;
  if (from.nullable && !to.nullable) {
    throw CompileError.at(at, `The ${what} may be null; declare the type as \`T | null\` to allow it.`);
  }
  if (isNumeric(from) && isNumeric(to)) {
    throw CompileError.at(
      at,
      `The ${what} is \`${describe(from)}\` but \`${describe(to)}\` was expected. PostgreSQL would round it silently where TypeScript keeps the fraction; declare the wider type, or make the value whole explicitly.`,
    );
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
  // Two of the same domain or enum stay that type; anything else meets as plain text.
  if (a.named && sameNamed(a, b)) return namedType(a.named, a.nullable || b.nullable);
  const allowed = a.allowed && b.allowed ? [...new Set([...a.allowed, ...b.allowed])] : undefined;
  return scalarType(scalar, a.nullable || b.nullable, allowed);
}

/** Widening casts are explicit in the IR so the emitter never has to guess. */
function coerce(expr: ExprIR, to: PgType): ExprIR {
  if (isArray(expr.type) && isArray(to)) {
    const [from, into] = [expr.type.element, to.element];
    if (!isScalar(from) || !isScalar(into) || (from.sql === into.sql && sameNamed(from, into))) return expr;
    // `[]` and `[1, 2]` were already built with the target's element type; a
    // literal reaching here can be retyped rather than cast.
    if (expr.kind === "arrayLiteral" && expr.parts.length === 0) return { ...expr, type: to };
    return { kind: "arrayCast", operand: expr, type: to };
  }
  if (!isScalar(expr.type) || !isScalar(to)) return expr;
  // Text into a domain or an enum, or out of one. TypeScript has already proven
  // the value is one of the set when the target names one, so the cast cannot
  // fail; an enum leaving for plain text is cast to text, which always succeeds.
  if (expr.type.sql === "text" && to.sql === "text" && !sameNamed(expr.type, to)) {
    const target = scalarType("text", expr.type.nullable, to.allowed, to.named);
    // An untyped literal takes the type of wherever it is put.
    if (expr.kind === "lit") return { ...expr, type: target };
    if (to.named) return { kind: "cast", operand: textOf(expr), to: "text", type: target };
    return textOf(expr);
  }
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
