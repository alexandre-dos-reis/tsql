/**
 * `while`, `for` and `for … of`.
 */
import {
  NodeFlags,
  SyntaxKind,
  type Expression,
  type ForOfStatement,
  type ForStatement,
  type Identifier,
  type VariableDeclarationList,
  type WhileStatement,
} from "typescript/unstable/ast";

import { CompileError } from "@/errors";
import { describe, isArray, isExactly, type ExprIR, type StmtIR, PG, BOOLEAN } from "@/ir";
import { lowerExpr } from "@/lower/expressions/expr";
import { scoped, uniqueName, within, type State } from "@/lower/state";
import { toSnakeCase } from "@/names";

import { lowerAssignment } from "./assignment";
import { lowerDeclarationList } from "./declarations";
import { asStatements, lowerStatements } from "./statement";

/** Like an `if` condition: a boolean. NULL stops a `WHILE` as `false` stops a TypeScript loop. */
function loopCondition(expression: Expression, cond: ExprIR, what: string): ExprIR {
  if (!isExactly(cond.type, PG.boolean)) {
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
export async function lowerWhile(node: WhileStatement, s: State): Promise<StmtIR> {
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
export async function lowerFor(node: ForStatement, s: State): Promise<StmtIR[]> {
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
      : { kind: "lit", value: true, type: BOOLEAN };

    const increment: StmtIR[] = [];
    if (node.incrementor) {
      const step = await lowerAssignment(node.incrementor, s);
      if (!step) throw CompileError.at(node.incrementor, "A `for` step must assign a variable (`i++`, `i += 2`).");
      increment.push(step);
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
export async function lowerForOf(node: ForOfStatement, s: State): Promise<StmtIR> {
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

  const array = await lowerExpr(node.expression, s);
  if (!isArray(array.type)) {
    throw CompileError.at(
      node.expression,
      isExactly(array.type, PG.text)
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
