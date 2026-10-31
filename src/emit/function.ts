/**
 * A function: `CREATE FUNCTION`, its parameters, its language and its body.
 */
import { isArray, type FunctionIR } from "@/ir.ts";
import { quoteIdentifier } from "@/names.ts";
import { DEFAULTS, type EmitOptions } from "./options.ts";
import { allowedNote, qualifier, typeName, unenforced } from "./qualify.ts";
import { emitStatements } from "./statements.ts";

export function emitFunction(fn: FunctionIR, options: EmitOptions = {}): string {
  const { schema, orReplace, comments } = { ...DEFAULTS, ...options };
  const qualify = qualifier(schema);
  const qualified = qualify(fn.sqlName);

  const lines: string[] = [];
  if (comments) {
    lines.push(`-- ${fn.module}: ${fn.tsName}()`);
    for (const param of fn.params) {
      const allowed = unenforced(param.type);
      if (allowed) lines.push(allowedNote(isArray(param.type) ? `${param.sqlName}[]` : param.sqlName, allowed));
    }
    const returned = unenforced(fn.returns);
    if (returned) lines.push(allowedNote(isArray(fn.returns) ? "returns[]" : "returns", returned));
  }

  const params = fn.params.map((p) => `  ${quoteIdentifier(p.sqlName)} ${typeName(p.type, schema)}`);
  lines.push(`${orReplace ? "CREATE OR REPLACE FUNCTION" : "CREATE FUNCTION"} ${qualified}(`);
  lines.push(params.join(",\n"));
  lines.push(")");
  lines.push(`RETURNS ${typeName(fn.returns, schema)}`);
  if (fn.language === "sql") {
    // One `return`: the SQL-standard body (PostgreSQL 14+), which PostgreSQL parses when it creates the
    // function, so what it calls and the types it names are recorded as dependencies.
    lines.push("LANGUAGE sql", "IMMUTABLE", ...emitStatements(fn.body, qualify, ""));
    return lines.join("\n");
  }
  lines.push("LANGUAGE plpgsql");
  lines.push("IMMUTABLE");
  lines.push("AS $$");
  if (fn.locals.length > 0) {
    lines.push("DECLARE");
    for (const local of fn.locals) {
      lines.push(`  ${quoteIdentifier(local.sqlName)} ${typeName(local.type, schema)};`);
    }
  }
  lines.push("BEGIN");
  lines.push(...emitStatements(fn.body, qualify, "  "));
  lines.push("END;");
  lines.push("$$;");
  return lines.join("\n");
}
