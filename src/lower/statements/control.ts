/**
 * `if` / `else` chains and `switch`.
 */
import {
  SyntaxKind,
  type CaseClause,
  type Expression,
  type IfStatement,
  type Statement,
  type SwitchStatement,
} from "typescript/unstable/ast";
import { CompileError } from "@/errors";
import { describe, isArray, isComposite, isExactly, sameNamed, scalarType, type ExprIR, type StmtIR } from "@/ir";
import { textOf } from "@/lower/coerce";
import { checkStrictEquality, strictEquality } from "@/lower/expressions/equality";
import { isNullLiteral, lowerExpr } from "@/lower/expressions/expr";
import { uniqueName, type State } from "@/lower/state";
import { asStatements, lowerClauseBody, lowerStatements, returnedValue } from "./statement";

export async function lowerIf(node: IfStatement, s: State): Promise<StmtIR> {
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
 *   `WHEN` with the same result — an expression with no effect, of which only one runs.
 */
export async function lowerSwitch(node: SwitchStatement, s: State): Promise<StmtIR[]> {
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
