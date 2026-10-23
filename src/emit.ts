import {
  fieldLabel,
  isScalar,
  type BinOp,
  type CompositeType,
  type ExprIR,
  type FunctionIR,
  type PgType,
  type StmtIR,
} from "./ir.ts";
import { quoteIdentifier, quoteLiteral } from "./names.ts";

export interface EmitOptions {
  /** Schema to qualify generated functions with. Omit for unqualified names. */
  readonly schema?: string | undefined;
  readonly orReplace?: boolean;
  readonly comments?: boolean;
}

const DEFAULTS = { orReplace: true, comments: true } satisfies EmitOptions;

/**
 * PostgreSQL operator precedence, lowest first. Used to emit the minimum number
 * of parentheses rather than fully parenthesising every subexpression.
 */
const PREC = {
  or: 1,
  and: 2,
  not: 3,
  is: 4,
  comparison: 5,
  concat: 6,
  additive: 7,
  multiplicative: 8,
  unary: 9,
  atom: 10,
} as const;

const BINARY_PRECEDENCE: Record<BinOp, number> = {
  or: PREC.or,
  and: PREC.and,
  "is distinct from": PREC.is,
  "is not distinct from": PREC.is,
  "=": PREC.comparison,
  "<>": PREC.comparison,
  "<": PREC.comparison,
  "<=": PREC.comparison,
  ">": PREC.comparison,
  ">=": PREC.comparison,
  "||": PREC.concat,
  "+": PREC.additive,
  "-": PREC.additive,
  "*": PREC.multiplicative,
  "/": PREC.multiplicative,
  "%": PREC.multiplicative,
};

function precedenceOf(expr: ExprIR): number {
  switch (expr.kind) {
    case "binary":
      return BINARY_PRECEDENCE[expr.op];
    case "not":
      return PREC.not;
    case "nullTest":
      return PREC.is;
    case "neg":
      return PREC.unary;
    default:
      return PREC.atom;
  }
}

/** Renders a function's SQL name, schema-qualified when a schema is in use. */
type Qualifier = (sqlName: string) => string;

function emitExpr(expr: ExprIR, q: Qualifier, minPrecedence = 0): string {
  const precedence = precedenceOf(expr);
  const text = emitExprInner(expr, q, precedence);
  return precedence < minPrecedence ? `(${text})` : text;
}

function emitExprInner(expr: ExprIR, q: Qualifier, precedence: number): string {
  switch (expr.kind) {
    case "ref":
      return quoteIdentifier(expr.sqlName);

    case "lit":
      if (expr.value === null) return "NULL";
      if (typeof expr.value === "boolean") return expr.value ? "true" : "false";
      if (typeof expr.value === "string") return quoteLiteral(expr.value);
      // An unadorned `1.5` is `numeric` in PostgreSQL — exact decimal, not the
      // IEEE double TypeScript computed with — so fractional literals are cast.
      // Whole numbers are already `integer` and widen implicitly.
      return !Number.isInteger(expr.value) && expr.type.sql === "double precision"
        ? `${numberLiteral(expr.value)}::double precision`
        : numberLiteral(expr.value);

    case "binary": {
      // Left-associative: the right operand needs one more level to keep
      // `a - (b - c)` and `a / (b / c)` parenthesised.
      const left = emitExpr(expr.left, q, precedence);
      const right = emitExpr(expr.right, q, precedence + 1);
      return `${left} ${operatorText(expr.op)} ${right}`;
    }

    case "not":
      return `NOT ${emitExpr(expr.operand, q, PREC.not + 1)}`;

    case "neg":
      return `-${emitExpr(expr.operand, q, PREC.unary)}`;

    case "nullTest":
      return `${emitExpr(expr.operand, q, PREC.is + 1)} IS ${expr.negated ? "NOT NULL" : "NULL"}`;

    case "coalesce":
      return `COALESCE(${emitExpr(expr.left, q)}, ${emitExpr(expr.right, q)})`;

    case "case":
      return `CASE WHEN ${emitExpr(expr.cond, q)} THEN ${emitExpr(expr.whenTrue, q)} ELSE ${emitExpr(expr.whenFalse, q)} END`;

    case "call":
      return `${q(expr.sqlName)}(${expr.args.map((a) => emitExpr(a, q)).join(", ")})`;

    case "field":
      // `(sub).plan` — the parentheses are required: `sub.plan` would be read
      // as a column reference on a table called `sub`.
      return `(${emitExpr(expr.operand, q)}).${quoteIdentifier(expr.sqlName)}`;

    case "cast":
      return `${emitExpr(expr.operand, q, PREC.atom)}::${expr.to}`;
  }
}

function numberLiteral(value: number): string {
  if (Number.isNaN(value) || !Number.isFinite(value)) {
    // Unreachable: lowering rejects these, but be explicit rather than emit `NaN`.
    throw new Error(`Cannot emit non-finite number: ${value}`);
  }
  return String(value);
}

/**
 * String-literal unions stay `text` on the database side. The permitted values
 * are recorded for the reader; enforcing them is a separate concern (an enum,
 * a domain, or a CHECK constraint).
 */
function allowedNote(name: string, allowed: readonly string[]): string {
  return `--   ${name}: one of ${allowed.map((v) => quoteLiteral(v)).join(", ")} (not enforced here)`;
}

function operatorText(op: string): string {
  return op === "and" || op === "or" || op.startsWith("is ") ? op.toUpperCase() : op;
}

function emitStatements(body: readonly StmtIR[], q: Qualifier, indent: string): string[] {
  const lines: string[] = [];
  for (const statement of body) {
    switch (statement.kind) {
      case "return":
        lines.push(`${indent}RETURN ${emitExpr(statement.expr, q)};`);
        break;

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
    }
  }
  return lines;
}

/** How a type is written in SQL: a scalar name, or a (possibly qualified) composite. */
function typeName(type: PgType, schema: string | undefined): string {
  if (isScalar(type)) return type.sql;
  return schema ? `${quoteIdentifier(schema)}.${quoteIdentifier(type.sqlName)}` : quoteIdentifier(type.sqlName);
}

export function emitFunction(fn: FunctionIR, options: EmitOptions = {}): string {
  const { schema, orReplace, comments } = { ...DEFAULTS, ...options };
  const qualify: Qualifier = (sqlName) =>
    schema ? `${quoteIdentifier(schema)}.${quoteIdentifier(sqlName)}` : quoteIdentifier(sqlName);
  const qualified = qualify(fn.sqlName);

  const lines: string[] = [];
  if (comments) {
    lines.push(`-- ${fn.module}: ${fn.tsName}()`);
    for (const param of fn.params) {
      if (isScalar(param.type) && param.type.allowed) lines.push(allowedNote(param.sqlName, param.type.allowed));
    }
    if (fn.returns.allowed) lines.push(allowedNote("returns", fn.returns.allowed));
  }

  const params = fn.params.map((p) => `  ${quoteIdentifier(p.sqlName)} ${typeName(p.type, schema)}`);
  lines.push(`${orReplace ? "CREATE OR REPLACE FUNCTION" : "CREATE FUNCTION"} ${qualified}(`);
  lines.push(params.join(",\n"));
  lines.push(")");
  lines.push(`RETURNS ${fn.returns.sql}`);
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

/**
 * Emit a composite type.
 *
 * `CREATE TYPE` has no `IF NOT EXISTS`, so the statement is guarded. The guard
 * also compares the existing shape against the expected one and raises, which
 * turns a stale type — a field renamed in TypeScript but never migrated — into
 * a loud migration failure instead of a function that silently returns NULL.
 *
 * Changing a composite's shape still needs a deliberate `ALTER TYPE`: this
 * creates, it never rewrites.
 */
export function emitCompositeType(composite: CompositeType, options: EmitOptions = {}): string {
  const { schema, comments } = { ...DEFAULTS, ...options };
  const qualified = typeName(composite, schema);
  const fields = composite.fields.map((f) => `${quoteIdentifier(f.sqlName)} ${f.type.sql}`);
  const expected = fields.map((f) => quoteLiteral(f)).join(", ");

  const lines: string[] = [];
  if (comments) {
    lines.push(`-- ${composite.module ?? "rules"}: ${composite.tsName}`);
    for (const field of composite.fields) {
      // A flattened column no longer looks like the shape it came from, so the
      // path is recorded for whoever reads the schema.
      if (field.path.length > 1) lines.push(`--   ${field.sqlName}: from ${fieldLabel(field.path)}`);
      if (field.type.allowed) lines.push(allowedNote(field.sqlName, field.type.allowed));
    }
  }
  lines.push(
    "DO $$",
    "DECLARE",
    `  expected text[] := ARRAY[${expected}];`,
    "  actual text[];",
    "BEGIN",
    `  IF to_regtype('${qualified}') IS NULL THEN`,
    `    CREATE TYPE ${qualified} AS (`,
    fields.map((f) => `      ${f}`).join(",\n"),
    "    );",
    "  ELSE",
    "    SELECT array_agg(a.attname || ' ' || format_type(a.atttypid, a.atttypmod) ORDER BY a.attnum)",
    "      INTO actual",
    "      FROM pg_attribute a",
    `     WHERE a.attrelid = (SELECT t.typrelid FROM pg_type t WHERE t.oid = to_regtype('${qualified}'))`,
    "       AND a.attnum > 0 AND NOT a.attisdropped;",
    "    IF actual IS DISTINCT FROM expected THEN",
    `      RAISE EXCEPTION '${qualified} exists as % but the rules expect %', actual, expected;`,
    "    END IF;",
    "  END IF;",
    "END",
    "$$;",
  );
  return lines.join("\n");
}

/**
 * Emit a migration: deterministic order, so re-running the compiler on
 * unchanged sources produces a byte-identical file.
 */
export function emitMigration(
  functions: readonly FunctionIR[],
  composites: readonly CompositeType[] = [],
  options: EmitOptions = {},
): string {
  const { schema, comments } = { ...DEFAULTS, ...options };
  const sortedFunctions = [...functions].sort((a, b) => a.sqlName.localeCompare(b.sqlName));
  const sortedComposites = [...composites].sort((a, b) => a.sqlName.localeCompare(b.sqlName));

  const parts: string[] = [];
  if (comments) {
    parts.push(
      [
        "-- Generated by ts-to-plpgsql. Do not edit.",
        "-- Source of truth: the TypeScript functions named in the comments below.",
      ].join("\n"),
    );
  }
  if (schema) parts.push(`CREATE SCHEMA IF NOT EXISTS ${quoteIdentifier(schema)};`);
  // Types first: the function signatures below refer to them.
  for (const composite of sortedComposites) parts.push(emitCompositeType(composite, options));
  for (const fn of sortedFunctions) parts.push(emitFunction(fn, options));
  return `${parts.join("\n\n")}\n`;
}
