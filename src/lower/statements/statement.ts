/**
 * Statements: the dispatcher, `return`, and the block helpers the other statement modules share.
 */
import {
  formatSyntaxKind,
  SyntaxKind,
  type Block,
  type BreakStatement,
  type Expression,
  type ExpressionStatement,
  type ForOfStatement,
  type ForStatement,
  type IfStatement,
  type ReturnStatement,
  type Statement,
  type SwitchStatement,
  type VariableStatement,
  type WhileStatement,
} from "typescript/unstable/ast";

import { CompileError } from "@/errors";
import { type ExprIR, type StmtIR } from "@/ir";
import { coerce, requireAssignable } from "@/lower/coerce";
import { lowerExpr } from "@/lower/expressions/expr";
import { within, type State, type Target } from "@/lower/state";

import { lowerAssignment } from "./assignment";
import { lowerIf, lowerSwitch } from "./control";
import { lowerVariableStatement } from "./declarations";
import { lowerFor, lowerForOf, lowerWhile } from "./loops";

export async function lowerReturn(expr: Expression, s: State): Promise<StmtIR> {
  const value = await lowerExpr(expr, s, s.returns);
  requireAssignable(value.type, s.returns, expr, "return value");
  return { kind: "return", expr: coerce(value, s.returns) };
}

export async function lowerStatements(statements: readonly Statement[], s: State): Promise<StmtIR[]> {
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
      throw CompileError.at(node, "This statement's value is discarded, which has no effect in a compiled function.");
    }

    default:
      throw CompileError.at(
        node,
        `${formatSyntaxKind(node.kind)} is not supported. The compiled subset is: \`const\` and \`let\` declarations, assignments, \`if\`/\`else\`, \`switch\`, \`while\`, \`for\`, \`for … of\` and \`return\`.`,
      );
  }
}

/** The value of a branch that does nothing but `return value`, already coerced to the return type. */
export function returnedValue(body: readonly StmtIR[]): ExprIR | undefined {
  const [only] = body;
  return body.length === 1 && only!.kind === "return" ? only!.expr : undefined;
}

export async function lowerClauseBody(
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

export function asStatements(node: Statement): readonly Statement[] {
  return node.kind === SyntaxKind.Block ? (node as Block).statements : [node];
}

export function alwaysReturns(body: readonly StmtIR[]): boolean {
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
