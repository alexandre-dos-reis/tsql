/**
 * Statements: the body of a PL/pgSQL function, one line at a time.
 */
import { type StmtIR } from "@/ir";
import { quoteIdentifier } from "@/names";

import { emitExpr } from "./expr";
import { type Qualifier } from "./qualify";

/** A `CASE` branch with nothing to do still needs a statement: `NULL;` is PL/pgSQL's no-op. */
function emitBranch(body: readonly StmtIR[], q: Qualifier, indent: string): string[] {
  return body.length > 0 ? emitStatements(body, q, indent) : [`${indent}NULL;`];
}

export function emitStatements(body: readonly StmtIR[], q: Qualifier, indent: string): string[] {
  const lines: string[] = [];
  for (const statement of body) {
    switch (statement.kind) {
      case "return": {
        // A returned CASE expression is laid out one WHEN per line: on a single
        // line it is short but hard to read. Nested ones stay inline.
        const expr = statement.expr;
        if (expr.kind === "simpleCaseExpr" || expr.kind === "searchedCaseExpr") {
          lines.push(`${indent}RETURN CASE${expr.kind === "simpleCaseExpr" ? ` ${emitExpr(expr.subject, q)}` : ""}`);
          for (const when of expr.whens) {
            const test = "value" in when ? when.value : when.cond;
            lines.push(`${indent}  WHEN ${emitExpr(test, q)} THEN ${emitExpr(when.result, q)}`);
          }
          lines.push(`${indent}  ELSE ${emitExpr(expr.orElse, q)}`, `${indent}END;`);
          break;
        }
        lines.push(`${indent}RETURN ${emitExpr(expr, q)};`);
        break;
      }

      case "assign":
        lines.push(`${indent}${quoteIdentifier(statement.sqlName)} := ${emitExpr(statement.expr, q)};`);
        break;

      case "if": {
        statement.branches.forEach((branch, i) => {
          lines.push(`${indent}${i === 0 ? "IF" : "ELSIF"} ${emitExpr(branch.cond, q)} THEN`);
          lines.push(...emitStatements(branch.body, q, `${indent}  `));
        });
        if (statement.orElse) {
          lines.push(`${indent}ELSE`);
          lines.push(...emitStatements(statement.orElse, q, `${indent}  `));
        }
        lines.push(`${indent}END IF;`);
        break;
      }

      case "simpleCase":
        lines.push(`${indent}CASE ${emitExpr(statement.subject, q)}`);
        for (const when of statement.whens) {
          lines.push(`${indent}  WHEN ${when.values.map((v) => emitExpr(v, q)).join(", ")} THEN`);
          lines.push(...emitBranch(when.body, q, `${indent}    `));
        }
        lines.push(`${indent}  ELSE`, ...emitBranch(statement.orElse, q, `${indent}    `), `${indent}END CASE;`);
        break;

      case "searchedCase":
        lines.push(`${indent}CASE`);
        for (const when of statement.whens) {
          lines.push(`${indent}  WHEN ${emitExpr(when.cond, q)} THEN`);
          lines.push(...emitBranch(when.body, q, `${indent}    `));
        }
        lines.push(`${indent}  ELSE`, ...emitBranch(statement.orElse, q, `${indent}    `), `${indent}END CASE;`);
        break;

      case "while":
        lines.push(`${indent}WHILE ${emitExpr(statement.cond, q)} LOOP`);
        lines.push(...emitBranch(statement.body, q, `${indent}  `));
        lines.push(`${indent}END LOOP;`);
        break;

      case "foreach":
        lines.push(
          `${indent}FOREACH ${quoteIdentifier(statement.variable)} IN ARRAY ${emitExpr(statement.array, q)} LOOP`,
        );
        lines.push(...emitBranch(statement.body, q, `${indent}  `));
        lines.push(`${indent}END LOOP;`);
        break;

      case "exit":
        lines.push(`${indent}EXIT;`);
        break;

      case "continue":
        lines.push(`${indent}CONTINUE;`);
        break;
    }
  }
  return lines;
}
