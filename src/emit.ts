import {
  fieldLabel,
  isArray,
  isScalar,
  type ArrayType,
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
    case "arrayIncludes":
      return PREC.is;
    case "neg":
      return PREC.unary;
    case "arrayLiteral":
      return expr.parts.length > 1 ? PREC.concat : PREC.atom;
    default:
      return PREC.atom;
  }
}

/**
 * Renders SQL names, schema-qualified when a schema is in use: `q(name)` for a
 * function, `q.type(composite)` for a composite type.
 */
interface Qualifier {
  (sqlName: string): string;
  type(composite: CompositeType): string;
}

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

    case "simpleCaseExpr":
      return `CASE ${emitExpr(expr.subject, q)} ${expr.whens
        .map((w) => `WHEN ${emitExpr(w.value, q)} THEN ${emitExpr(w.result, q)}`)
        .join(" ")} ELSE ${emitExpr(expr.orElse, q)} END`;

    case "searchedCaseExpr":
      return `CASE ${expr.whens
        .map((w) => `WHEN ${emitExpr(w.cond, q)} THEN ${emitExpr(w.result, q)}`)
        .join(" ")} ELSE ${emitExpr(expr.orElse, q)} END`;

    case "call":
      return `${q(expr.sqlName)}(${expr.args.map((a) => emitExpr(a, q)).join(", ")})`;

    case "field":
      // `(sub).plan` — the parentheses are required: `sub.plan` would be read
      // as a column reference on a table called `sub`.
      return `(${emitExpr(expr.operand, q)}).${quoteIdentifier(expr.sqlName)}`;

    case "cast":
      return `${emitExpr(expr.operand, q, PREC.atom)}::${expr.to}`;

    case "row":
      // One argument per flattened field, in field order, cast to the named
      // composite: PostgreSQL composites are nominal, so a bare ROW() will not do.
      return `ROW(${expr.args.map((a) => emitExpr(a, q)).join(", ")})::${q.type(expr.type)}`;

    case "arrayLength":
      return `cardinality(${emitExpr(expr.operand, q)})`;

    case "arrayIncludes":
      return `array_position(${emitExpr(expr.array, q)}, ${emitExpr(expr.value, q)}) IS NOT NULL`;

    case "arrayLiteral": {
      // Every run is cast: `ARRAY[]` has no type of its own, and `ARRAY[1]`
      // would not say `double precision[]` when that is what was declared.
      const arrayType = arrayTypeName(expr.type, q);
      if (expr.parts.length === 0) return `ARRAY[]::${arrayType}`;
      return expr.parts
        .map((part, i) =>
          part.kind === "items"
            ? `ARRAY[${part.items.map((item) => emitExpr(item, q)).join(", ")}]::${arrayType}`
            : // Left-associative, like any binary operator: a later operand of
              // `||` binds one level tighter.
              emitExpr(part.array, q, i === 0 ? precedence : precedence + 1),
        )
        .join(" || ");
    }

    case "arrayCast":
      return `${emitExpr(expr.operand, q, PREC.atom)}::${arrayTypeName(expr.type, q)}`;
  }
}

function arrayTypeName(type: ArrayType, q: Qualifier): string {
  return `${isScalar(type.element) ? type.element.sql : q.type(type.element)}[]`;
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

/** A `CASE` branch with nothing to do still needs a statement: `NULL;` is PL/pgSQL's no-op. */
function emitBranch(body: readonly StmtIR[], q: Qualifier, indent: string): string[] {
  return body.length > 0 ? emitStatements(body, q, indent) : [`${indent}NULL;`];
}

function emitStatements(body: readonly StmtIR[], q: Qualifier, indent: string): string[] {
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
        lines.push(`${indent}FOREACH ${quoteIdentifier(statement.variable)} IN ARRAY ${emitExpr(statement.array, q)} LOOP`);
        lines.push(...emitBranch(statement.body, q, `${indent}  `));
        lines.push(`${indent}END LOOP;`);
        break;

      case "raise":
        lines.push(`${indent}RAISE EXCEPTION '%', ${emitExpr(statement.message, q)};`);
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

/** How a type is written in SQL: a scalar name, a (possibly qualified) composite, or an array of either. */
function typeName(type: PgType, schema: string | undefined): string {
  if (isArray(type)) return `${typeName(type.element, schema)}[]`;
  if (isScalar(type)) return type.sql;
  return schema ? `${quoteIdentifier(schema)}.${quoteIdentifier(type.sqlName)}` : quoteIdentifier(type.sqlName);
}

export function emitFunction(fn: FunctionIR, options: EmitOptions = {}): string {
  const { schema, orReplace, comments } = { ...DEFAULTS, ...options };
  const qualify = ((sqlName: string) =>
    schema ? `${quoteIdentifier(schema)}.${quoteIdentifier(sqlName)}` : quoteIdentifier(sqlName)) as Qualifier;
  qualify.type = (composite) => typeName(composite, schema);
  const qualified = qualify(fn.sqlName);

  const lines: string[] = [];
  if (comments) {
    lines.push(`-- ${fn.module}: ${fn.tsName}()`);
    for (const param of fn.params) {
      if (isScalar(param.type) && param.type.allowed) lines.push(allowedNote(param.sqlName, param.type.allowed));
      if (isArray(param.type) && isScalar(param.type.element) && param.type.element.allowed) {
        lines.push(allowedNote(`${param.sqlName}[]`, param.type.element.allowed));
      }
    }
    if (isScalar(fn.returns) && fn.returns.allowed) lines.push(allowedNote("returns", fn.returns.allowed));
  }

  const params = fn.params.map((p) => `  ${quoteIdentifier(p.sqlName)} ${typeName(p.type, schema)}`);
  lines.push(`${orReplace ? "CREATE OR REPLACE FUNCTION" : "CREATE FUNCTION"} ${qualified}(`);
  lines.push(params.join(",\n"));
  lines.push(")");
  lines.push(`RETURNS ${typeName(fn.returns, schema)}`);
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
  const fields = composite.fields.map((f) => `${quoteIdentifier(f.sqlName)} ${typeName(f.type, schema)}`);
  // The guard compares against `format_type`, which writes a type from another
  // schema qualified or not depending on the search path. A column holding an
  // array of composites is therefore expected through `format_type` too, so
  // both sides are written the same way.
  //
  // The names are unquoted, as `pg_attribute.attname` holds them: a field named
  // `limit` is `"limit"` in `CREATE TYPE` but `limit` in the catalogue.
  const expected = composite.fields
    .map((f) =>
      isArray(f.type) && !isScalar(f.type.element)
        ? `${quoteLiteral(`${f.sqlName} `)} || format_type(to_regtype(${quoteLiteral(typeName(f.type, schema))}), NULL)`
        : quoteLiteral(`${f.sqlName} ${typeName(f.type, schema)}`),
    )
    .join(", ");

  const lines: string[] = [];
  if (comments) {
    lines.push(`-- ${composite.module ?? "rules"}: ${composite.tsName}`);
    for (const field of composite.fields) {
      // A flattened column no longer looks like the shape it came from, so the
      // path is recorded for whoever reads the schema.
      if (field.path.length > 1) lines.push(`--   ${field.sqlName}: from ${fieldLabel(field.path)}`);
      if (isScalar(field.type) && field.type.allowed) lines.push(allowedNote(field.sqlName, field.type.allowed));
      if (isArray(field.type) && isScalar(field.type.element) && field.type.element.allowed) {
        lines.push(allowedNote(`${field.sqlName}[]`, field.type.element.allowed));
      }
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
 * Composites in name order, except that a type comes after the types its array
 * fields hold: `CREATE TYPE app.purchase AS (lines app.purchase_line[])` needs
 * `app.purchase_line` to exist. Lowering refuses cycles, so this terminates.
 */
function dependencyOrder(composites: readonly CompositeType[]): CompositeType[] {
  const ordered: CompositeType[] = [];
  const placed = new Set<string>();
  const byName = new Map(composites.map((c) => [c.sqlName, c]));
  const place = (composite: CompositeType): void => {
    if (placed.has(composite.sqlName)) return;
    placed.add(composite.sqlName);
    for (const field of composite.fields) {
      if (isArray(field.type) && !isScalar(field.type.element)) {
        place(byName.get(field.type.element.sqlName) ?? field.type.element);
      }
    }
    ordered.push(composite);
  };
  for (const composite of composites) place(composite);
  return ordered;
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
  const sortedComposites = dependencyOrder([...composites].sort((a, b) => a.sqlName.localeCompare(b.sqlName)));

  const parts: string[] = [];
  if (comments) {
    parts.push(
      [
        "-- Generated by tsql. Do not edit.",
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
