/**
 * The types a migration creates: composites, domains and enums, each guarded so that re-running it compares the existing shape and refuses a drift.
 */
import { isArray, isScalar, namedType, type CompositeType, type NamedText, type PgType } from "@/ir";
import { quoteIdentifier, quoteLiteral } from "@/names";

import { DEFAULTS, type EmitOptions } from "./options";
import { allowedNote, typeName, unenforced } from "./qualify";

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
  // schema qualified or not depending on the search path. A column of one of our
  // own types — a composite, a domain, an enum, or an array of one — is
  // therefore expected through `format_type` too, so both sides are written the
  // same way.
  //
  // The names are unquoted, as `pg_attribute.attname` holds them: a field named
  // `limit` is `"limit"` in `CREATE TYPE` but `limit` in the catalogue.
  const ours = (t: PgType): boolean => (isArray(t) ? ours(t.element) : !isScalar(t) || t.named !== undefined);
  const expected = composite.fields
    .map((f) =>
      ours(f.type)
        ? `${quoteLiteral(`${f.sqlName} `)} || format_type(to_regtype(${quoteLiteral(typeName(f.type, schema))}), NULL)`
        : quoteLiteral(`${f.sqlName} ${typeName(f.type, schema)}`),
    )
    .join(", ");

  const lines: string[] = [];
  if (comments) {
    lines.push(`-- ${composite.module ?? "functions"}: ${composite.tsName}`);
    for (const field of composite.fields) {
      const allowed = unenforced(field.type);
      if (allowed) lines.push(allowedNote(isArray(field.type) ? `${field.sqlName}[]` : field.sqlName, allowed));
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
    `      RAISE EXCEPTION '${qualified} exists as % but the functions expect %', actual, expected;`,
    "    END IF;",
    "  END IF;",
    "END",
    "$$;",
  );
  return lines.join("\n");
}

/**
 * A union of string literals: a domain over `text` whose CHECK names the values.
 *
 * `CREATE DOMAIN` has no `IF NOT EXISTS`, so it is guarded. The CHECK is a named
 * constraint the compiler owns: when the union changes, it is dropped and added
 * again, and adding it re-checks every column of the domain — so a value still
 * in use cannot be removed silently; the migration fails on the offending rows.
 * The definition is compared through `pg_get_constraintdef`, so an unchanged
 * union touches nothing.
 */
export function emitDomain(named: NamedText, options: EmitOptions = {}): string {
  const { schema, comments } = { ...DEFAULTS, ...options };
  const qualified = typeName(namedType(named), schema);
  const constraint = `${named.sqlName}_values`;
  const check = `CHECK (VALUE = ANY (ARRAY[${named.values.map(quoteLiteral).join(", ")}]))`;
  // How PostgreSQL prints that constraint back.
  const printed = `CHECK ((VALUE = ANY (ARRAY[${named.values.map((v) => `${quoteLiteral(v)}::text`).join(", ")}])))`;
  const lines: string[] = [];
  if (comments) lines.push(`-- ${named.module ?? "functions"}: ${named.tsName}, a union of strings`);
  lines.push(
    "DO $$",
    "DECLARE",
    `  expected text := ${quoteLiteral(printed)};`,
    "  actual text;",
    "BEGIN",
    `  IF to_regtype(${quoteLiteral(qualified)}) IS NULL THEN`,
    `    CREATE DOMAIN ${qualified} AS text CONSTRAINT ${quoteIdentifier(constraint)} ${check};`,
    "  ELSE",
    `    IF (SELECT t.typtype <> 'd' OR t.typbasetype <> 'text'::regtype FROM pg_type t WHERE t.oid = to_regtype(${quoteLiteral(qualified)})) THEN`,
    `      RAISE EXCEPTION '% exists but is not a domain over text', ${quoteLiteral(qualified)};`,
    "    END IF;",
    "    SELECT pg_get_constraintdef(c.oid) INTO actual",
    "      FROM pg_constraint c",
    `     WHERE c.contypid = to_regtype(${quoteLiteral(qualified)}) AND c.conname = ${quoteLiteral(constraint)};`,
    "    IF actual IS DISTINCT FROM expected THEN",
    `      ALTER DOMAIN ${qualified} DROP CONSTRAINT IF EXISTS ${quoteIdentifier(constraint)};`,
    `      ALTER DOMAIN ${qualified} ADD CONSTRAINT ${quoteIdentifier(constraint)} ${check};`,
    "    END IF;",
    "  END IF;",
    "END",
    "$$;",
  );
  return lines.join("\n");
}

/**
 * A string `enum` or an `as const` object: a PostgreSQL enum, in the order written.
 *
 * Guarded like every type, and convergent: a value added in TypeScript is added
 * in place (`ADD VALUE … BEFORE` the next existing one), so the database order
 * stays the source order, which PostgREST sorts and filters by. A value removed
 * or reordered is never acted on — enum values cannot be dropped — and the
 * migration fails saying what to do. Adding a value is allowed in a transaction,
 * but the new value cannot be used until it commits.
 */
export function emitEnum(named: NamedText, options: EmitOptions = {}): string {
  const { schema, comments } = { ...DEFAULTS, ...options };
  const qualified = typeName(namedType(named), schema);
  const name = quoteLiteral(qualified);
  const values = named.values.map(quoteLiteral).join(", ");
  const lines: string[] = [];
  if (comments) lines.push(`-- ${named.module ?? "functions"}: ${named.tsName}, an enum`);
  lines.push(
    "DO $$",
    "DECLARE",
    `  expected text[] := ARRAY[${values}];`,
    "  actual text[];",
    "  next_existing text;",
    "BEGIN",
    `  IF to_regtype(${name}) IS NULL THEN`,
    `    CREATE TYPE ${qualified} AS ENUM (${values});`,
    "    RETURN;",
    "  END IF;",
    `  IF (SELECT t.typtype FROM pg_type t WHERE t.oid = to_regtype(${name})) <> 'e' THEN`,
    `    RAISE EXCEPTION '% exists but is not an enum', ${name};`,
    "  END IF;",
    "  SELECT array_agg(e.enumlabel::text ORDER BY e.enumsortorder) INTO actual",
    `    FROM pg_enum e WHERE e.enumtypid = to_regtype(${name});`,
    "  IF EXISTS (SELECT 1 FROM unnest(actual) AS a(v) WHERE v <> ALL (expected)) THEN",
    `    RAISE EXCEPTION '% has % but the functions expect %: a value was removed or renamed. Rename it with ALTER TYPE % RENAME VALUE, or migrate the rows and recreate the type.', ${name}, actual, expected, ${name};`,
    "  END IF;",
    "  IF actual IS DISTINCT FROM ARRAY(SELECT v FROM unnest(expected) WITH ORDINALITY AS u(v, n) WHERE v = ANY (actual) ORDER BY n) THEN",
    `    RAISE EXCEPTION '% has % but the functions expect %: the values were reordered', ${name}, actual, expected;`,
    "  END IF;",
    "  FOR i IN REVERSE cardinality(expected) .. 1 LOOP",
    "    CONTINUE WHEN expected[i] = ANY (actual);",
    "    SELECT v INTO next_existing FROM unnest(expected[i + 1:]) WITH ORDINALITY AS u(v, n)",
    "     WHERE v = ANY (actual) ORDER BY n LIMIT 1;",
    "    IF next_existing IS NULL THEN",
    `      EXECUTE format(${quoteLiteral(`ALTER TYPE ${qualified} ADD VALUE IF NOT EXISTS %L`)}, expected[i]);`,
    "    ELSE",
    `      EXECUTE format(${quoteLiteral(`ALTER TYPE ${qualified} ADD VALUE IF NOT EXISTS %L BEFORE %L`)}, expected[i], next_existing);`,
    "    END IF;",
    "    actual := actual || expected[i];",
    "  END LOOP;",
    "END",
    "$$;",
  );
  return lines.join("\n");
}
