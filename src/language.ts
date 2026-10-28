/**
 * Which compiled functions are emitted as `LANGUAGE sql`, and in what order they are created.
 *
 * A function whose whole body is `return <expression>` can be a SQL function, and PostgreSQL then
 * *inlines* the call: the planner sees `v > 990` where it would see an opaque `f(v)`, so an index is
 * usable, a `CHECK` or a row-level security policy costs no call per row, and the answer is the same
 * (the parity harness runs both). A PL/pgSQL function is never inlined. Measured on PGlite, 300 000
 * rows, an index on `v`: 369 ms and a sequential scan against 3 ms and a bitmap scan.
 *
 * Two things make a function stay PL/pgSQL, because a SQL function is checked when it is created:
 * - it has statements beyond the `return` (a local, an `if`, a loop): there is no single expression;
 * - it writes an enum value as a literal (`'pro'::app.plan`): PostgreSQL refuses a value added by
 *   `ALTER TYPE … ADD VALUE` in the same transaction when a function that names it is *created*, which
 *   a migration adding the value and the function does. PL/pgSQL looks at the body only when it runs;
 * - it takes part in a cycle of SQL functions (itself included): each would have to exist before the
 *   other. Recursion is left to PL/pgSQL, which looks a call up only when it runs.
 */

import { someExpr, type ExprIR, type FunctionIR } from "./ir.ts";

const isEnumLiteral = (expr: ExprIR) => expr.kind === "lit" && expr.type.named?.kind === "enum";

/** The functions with `language` decided. Nothing else about them changes. */
export function chooseLanguages(functions: readonly FunctionIR[]): FunctionIR[] {
  const byName = new Map(functions.map((fn) => [fn.sqlName, fn]));
  const namesEnumValue = (fn: FunctionIR) =>
    fn.body.some((statement) => statement.kind === "return" && someExpr(statement.expr, isEnumLiteral));
  const eligible = new Set(
    functions.filter(
      (fn) => fn.locals.length === 0 && fn.body.length === 1 && fn.body[0]!.kind === "return" && !namesEnumValue(fn),
    ),
  );

  // A function is in a cycle when it can reach itself through eligible functions only: PL/pgSQL ones
  // hold no creation-time dependency, so a path through one is no cycle.
  const reaches = (from: FunctionIR, target: FunctionIR, seen = new Set<FunctionIR>()): boolean => {
    for (const name of from.calls) {
      const callee = byName.get(name);
      if (!callee || !eligible.has(callee)) continue;
      if (callee === target) return true;
      if (seen.has(callee)) continue;
      seen.add(callee);
      if (reaches(callee, target, seen)) return true;
    }
    return false;
  };

  return functions.map((fn) => ({
    ...fn,
    language: eligible.has(fn) && !reaches(fn, fn) ? "sql" : "plpgsql",
  }));
}

/**
 * The order to create the functions in: by name, except that a SQL function comes after every function
 * it calls — PostgreSQL resolves those calls when it creates it. Deterministic, so recompiling
 * unchanged sources gives a byte-identical migration.
 */
export function creationOrder(functions: readonly FunctionIR[]): FunctionIR[] {
  const byName = new Map(functions.map((fn) => [fn.sqlName, fn]));
  const ordered: FunctionIR[] = [];
  const seen = new Set<FunctionIR>();
  const visit = (fn: FunctionIR) => {
    if (seen.has(fn)) return;
    seen.add(fn);
    if (fn.language === "sql") {
      for (const name of fn.calls) {
        const callee = byName.get(name);
        if (callee) visit(callee);
      }
    }
    ordered.push(fn);
  };
  for (const fn of [...functions].sort((a, b) => a.sqlName.localeCompare(b.sqlName))) visit(fn);
  return ordered;
}
