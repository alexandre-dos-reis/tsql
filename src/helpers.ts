/**
 * The functions tsql installs in the user's database, in the `tsql` schema.
 *
 * A `Math` member whose SQL has to read its argument several times
 * (`Math.round(x)`: `x - floor(x) >= 0.5 … floor(x) + 1 … floor(x)`) does not
 * write that out where it is used. It calls `tsql.math_round(x)`, so the argument
 * is evaluated once, the compiled function stays readable, and the SQL that
 * matches JavaScript is written down in one place (`docs/design.md`, "The `tsql`
 * schema").
 *
 * The set is closed and small. The schema is fixed — not an option, not read from
 * the TypeScript — and the user's own `--schema` may not be it.
 *
 * A migration carries the helpers its functions use, not all of them, and brings
 * them up to date itself (`runtimeSql`): there is no command to run. Because a
 * helper is `IMMUTABLE` and an index or a stored generated column may hold what it
 * returned, changing one is a decision: the text is locked to a revision by
 * `src/helpersLock.ts`, and a migration that replaces a body announces it.
 */

import { createHash } from "node:crypto";
import { HELPER_HASHES } from "./helpersLock.ts";

/** The schema the helpers live in. Reserved: `--schema` may not be it. */
export const TSQL_SCHEMA = "tsql";

/**
 * How many times the helpers have been recorded (`src/helpersLock.ts`, appended to
 * by `bun scripts/helpers.ts lock`). A database that already holds a higher
 * revision refuses the migration: an older tsql must not overwrite a fix.
 */
export const HELPERS_REVISION = HELPER_HASHES.length;

/** The edges of `real`: its largest value, the point from which rounding goes to infinity, and half its smallest. */
const REAL_MAX = (2 - 2 ** -23) * 2 ** 127;
const REAL_OVERFLOW = REAL_MAX + 2 ** 103;
const REAL_UNDERFLOW = 2 ** -150;

export interface Helper {
  /** `name double precision, …` as written between the parentheses. */
  readonly params: string;
  /** The types of the parameters, for `to_regprocedure`. */
  readonly signature: string;
  readonly returns: string;
  /** The body: one `SELECT`. Every function it calls is written `pg_catalog.…`, so the search path cannot change what it means. */
  readonly body: string;
}

const D = "double precision";

/**
 * JavaScript's StrWhiteSpace, which `parseInt` skips before anything else.
 * PostgreSQL's `E''` has no `\v`, so the vertical tab is written `\x0B`.
 */
const WHITESPACE =
  "\\t\\n\\x0B\\f\\r \\u00a0\\u1680\\u2000\\u2001\\u2002\\u2003\\u2004\\u2005\\u2006\\u2007\\u2008\\u2009\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff";

/**
 * The value from which a double rounds to Infinity: the midpoint between the
 * largest double and 2^1024, which is 2^1024 - 2^970. Exact, as a decimal
 * integer, so the comparison happens in `numeric` and not in floating point.
 */
const INFINITE_AT = (2n ** 1024n - 2n ** 970n).toString();

/** The input with leading whitespace removed. A schema-qualified `substring` takes two arguments, never `from`. */
const TRIMMED = `pg_catalog.ltrim(s, E'${WHITESPACE}')`;
/** The longest prefix JavaScript would read in base ten: a sign and digits. NULL when there is none. */
const MATCHED = `pg_catalog.substring(${TRIMMED}, '^[+-]?[0-9]+')`;
const NEGATIVE = `pg_catalog.left(${MATCHED}, 1) = '-'`;
/** The digits alone, without sign or leading zeros, so `''` means the value is a zero. */
const DIGITS = `pg_catalog.ltrim(pg_catalog.ltrim(${MATCHED}, '+-'), '0')`;
/**
 * The `0x` prefix with its sign, NULL when there is none. Detecting the prefix
 * is separate from reading the digits because JavaScript *commits* to base 16
 * on seeing it: `parseInt('0x')` and `parseInt('0xzz')` are NaN, not the 0 that
 * falling back to base ten would read off the leading zero.
 */
const HEX_PREFIX = `pg_catalog.substring(${TRIMMED}, '^[+-]?0[xX]')`;
/**
 * Base ten, as an expression rather than a call: `parse_int` falls back to it
 * when there is no `0x` prefix, and a helper calling another helper would need
 * the migration to carry and create them in dependency order, which it does not
 * — it installs the helpers its *functions* use.
 */
const DECIMAL = `CASE WHEN ${MATCHED} IS NULL THEN 'NaN'::${D} WHEN ${DIGITS} = '' THEN CASE WHEN ${NEGATIVE} THEN '-0'::${D} ELSE 0::${D} END WHEN pg_catalog.length(${DIGITS}) > 309 OR ${DIGITS}::numeric >= ${INFINITE_AT}::numeric THEN CASE WHEN ${NEGATIVE} THEN '-Infinity'::${D} ELSE 'Infinity'::${D} END ELSE ${MATCHED}::numeric::${D} END`;
/** The hexadecimal digits after that prefix, NULL when the prefix is followed by none. */
const HEX = `pg_catalog.substring(${TRIMMED}, '^[+-]?0[xX]([0-9a-fA-F]+)')`;
const HEX_NEGATIVE = `pg_catalog.left(${HEX_PREFIX}, 1) = '-'`;

/**
 * Written so that each returns the same double as the JavaScript function, for
 * every input including `NaN`, the infinities and `-0`; `docs/design.md` ("Math")
 * says what each one is for, and `tests/specialValues.test.ts` checks them.
 */
export const HELPERS = {
  // PostgreSQL's `round` sends a tie to the even neighbour; `Math.round` sends it up.
  // A result of -0 is kept for -0.5 <= x < 0.
  math_round: {
    params: `x ${D}`,
    signature: D,
    returns: D,
    body: `SELECT CASE WHEN x - pg_catalog.floor(x) >= 0.5::${D} THEN CASE WHEN pg_catalog.floor(x) + 1 = 0 AND x < 0 THEN '-0'::${D} ELSE pg_catalog.floor(x) + 1 END ELSE pg_catalog.floor(x) END`,
  },
  // The cast to `real` raises beyond the range of `real` where `Math.fround` gives
  // `Infinity` or 0.
  math_fround: {
    params: `x ${D}`,
    signature: D,
    returns: D,
    body: `SELECT CASE WHEN x = 'NaN'::${D} OR x = 0 OR pg_catalog.abs(x) = 'Infinity'::${D} THEN x WHEN pg_catalog.abs(x) >= ${REAL_OVERFLOW}::${D} THEN pg_catalog.sign(x) * 'Infinity'::${D} WHEN pg_catalog.abs(x) <= ${REAL_UNDERFLOW}::${D} THEN pg_catalog.sign(x) * 0 ELSE x::real::${D} END`,
  },
  // `sign('NaN')` and `sign(-0)` are 0.
  math_sign: {
    params: `x ${D}`,
    signature: D,
    returns: D,
    body: `SELECT CASE WHEN x = 0 OR x = 'NaN'::${D} THEN x ELSE pg_catalog.sign(x) END`,
  },
  // `sqrt` raises on a negative argument.
  math_sqrt: {
    params: `x ${D}`,
    signature: D,
    returns: D,
    body: `SELECT CASE WHEN x < 0 THEN 'NaN'::${D} ELSE pg_catalog.sqrt(x) END`,
  },
  // `GREATEST` returns whichever of 0 and -0 came first; `atan2(z, -1)` is -pi for -0 and pi for 0.
  math_max: {
    params: `a ${D}, b ${D}`,
    signature: `${D}, ${D}`,
    returns: D,
    body: `SELECT CASE WHEN a = 0 AND b = 0 THEN CASE WHEN pg_catalog.atan2(a, -1) < 0 AND pg_catalog.atan2(b, -1) < 0 THEN '-0'::${D} ELSE 0 END ELSE GREATEST(a, b) END`,
  },
  // `LEAST` skips a `NaN` where `Math.min` returns it; `GREATEST` returns it, and negation is exact.
  math_min: {
    params: `a ${D}, b ${D}`,
    signature: `${D}, ${D}`,
    returns: D,
    body: `SELECT CASE WHEN a = 0 AND b = 0 THEN CASE WHEN pg_catalog.atan2(a, -1) < 0 OR pg_catalog.atan2(b, -1) < 0 THEN '-0'::${D} ELSE 0 END ELSE -GREATEST(-a, -b) END`,
  },
  // The leading zeros of the 32-bit pattern, which `integer` is.
  math_clz32: {
    params: "x integer",
    signature: "integer",
    returns: "integer",
    body: "SELECT COALESCE(NULLIF(position('1' IN x::bit(32)), 0) - 1, 32)",
  },
  // The product wrapped to 32 bits, computed in `bigint` (no `integer` overflow, no error).
  math_imul: {
    params: "a integer, b integer",
    signature: "integer, integer",
    returns: "integer",
    body: "SELECT (((a::bigint * b::bigint + 2147483648) % 4294967296 + 4294967296) % 4294967296 - 2147483648)::integer",
  },
  // `Number.parseInt`. JavaScript reads a prefix and ignores the rest, so this
  // is a parser, not a cast: `'12abc'::integer` would raise where `parseInt`
  // answers 12. Measured against V8 on whitespace, signs, trailing garbage,
  // `-0`, the 2^53 rounding ties and the overflow boundary (`docs/design.md`,
  // "Number.parseInt").
  //
  // Three things PostgreSQL does differently, each closed here:
  //   - `numeric::double precision` RAISES past the double range; JavaScript
  //     gives Infinity. Guarded by the digit count first, so a million-digit
  //     argument never builds a numeric, then by the exact rounding boundary.
  //   - `numeric` has no `-0`, so "-0" and "-000" are answered directly.
  //   - no digits at all is `NaN`, not NULL and not an error.
  parse_int_10: {
    params: "s text",
    signature: "text",
    returns: D,
    body: `SELECT ${DECIMAL}`,
  },
  // `Number.parseInt` with no radix, which reads an `0x` prefix as hexadecimal.
  // Summing the digits weighted by position is exact at every width, including
  // the 2^53 ties and the 256-hex-digit overflow boundary; it needs an
  // aggregate, so this is the one helper that does not inline. Correctness wins:
  // a shorter form would have to truncate past the mantissa and round wrongly.
  parse_int: {
    params: "s text",
    signature: "text",
    returns: D,
    body: `SELECT CASE WHEN ${HEX_PREFIX} IS NULL THEN ${DECIMAL} WHEN ${HEX} IS NULL THEN 'NaN'::${D} WHEN v >= ${INFINITE_AT}::numeric THEN CASE WHEN ${HEX_NEGATIVE} THEN '-Infinity'::${D} ELSE 'Infinity'::${D} END WHEN v = 0 AND ${HEX_NEGATIVE} THEN '-0'::${D} WHEN ${HEX_NEGATIVE} THEN -v::${D} ELSE v::${D} END FROM (SELECT COALESCE(pg_catalog.sum(('x' || d)::bit(4)::integer::numeric * 16::numeric ^ (n - 1)), 0) AS v FROM pg_catalog.regexp_split_to_table(pg_catalog.reverse(${HEX}), '') WITH ORDINALITY AS t(d, n)) q`,
  },
} as const satisfies Record<string, Helper>;

export type HelperName = keyof typeof HELPERS;

/** A hash of the text that decides what the helpers do: what `src/helpersLock.ts` pins to a revision. */
export function helperFingerprint(): string {
  const text = JSON.stringify(
    Object.keys(HELPERS)
      .sort()
      .map((name) => [name, HELPERS[name as HelperName]]),
  );
  return createHash("sha256").update(text).digest("hex");
}

function definition(name: HelperName): string {
  const helper: Helper = HELPERS[name];
  return [
    `CREATE OR REPLACE FUNCTION ${TSQL_SCHEMA}.${name}(${helper.params})`,
    `RETURNS ${helper.returns}`,
    "LANGUAGE sql",
    "IMMUTABLE PARALLEL SAFE",
    `AS $body$${helper.body}$body$`,
  ].join("\n");
}

/**
 * The section of a migration that installs the helpers `names`, before the
 * functions that call them.
 *
 * - It refuses a database that holds a newer revision (a bug fix an older tsql
 *   would undo).
 * - It replaces each helper, and says so when what was installed differed: stored
 *   values computed with the old body (an index, a generated column) are the
 *   user's to rebuild.
 * - It records the revision.
 *
 * Replacing is idempotent, so applying the migration again changes nothing.
 */
export function runtimeSql(names: readonly HelperName[], comments = true): string {
  const rows = [...names]
    .sort()
    .map((name) => `    ('${TSQL_SCHEMA}.${name}(${HELPERS[name].signature})', $def$${definition(name)}$def$)`)
    .join(",\n");
  return [
    ...(comments ? [`-- tsql runtime, revision ${HELPERS_REVISION}: the helpers the functions below call.`] : []),
    `CREATE SCHEMA IF NOT EXISTS ${TSQL_SCHEMA};`,
    `CREATE TABLE IF NOT EXISTS ${TSQL_SCHEMA}.runtime (`,
    "  only_row boolean PRIMARY KEY DEFAULT true CHECK (only_row),",
    "  revision integer NOT NULL",
    ");",
    "DO $tsql$",
    "DECLARE",
    "  installed integer;",
    "  helper text;",
    "  sql text;",
    "  before text;",
    "  after text;",
    "BEGIN",
    `  SELECT revision INTO installed FROM ${TSQL_SCHEMA}.runtime;`,
    `  IF installed > ${HELPERS_REVISION} THEN`,
    `    RAISE EXCEPTION 'this database holds tsql runtime revision %, newer than the revision ${HELPERS_REVISION} this tsql writes: update tsql before compiling again', installed;`,
    "  END IF;",
    "  FOR helper, sql IN SELECT * FROM (VALUES",
    rows,
    "  ) AS t(helper, sql) LOOP",
    "    SELECT prosrc INTO before FROM pg_catalog.pg_proc WHERE oid = pg_catalog.to_regprocedure(helper);",
    "    EXECUTE sql;",
    "    SELECT prosrc INTO after FROM pg_catalog.pg_proc WHERE oid = pg_catalog.to_regprocedure(helper);",
    "    IF before IS NOT NULL AND before <> after THEN",
    `      RAISE NOTICE 'tsql: % was replaced (runtime revision ${HELPERS_REVISION}). Rebuild what was computed with the old one: indexes, stored generated columns, materialized views.', helper;`,
    "    END IF;",
    "  END LOOP;",
    `  INSERT INTO ${TSQL_SCHEMA}.runtime (revision) VALUES (${HELPERS_REVISION})`,
    "    ON CONFLICT (only_row) DO UPDATE SET revision = excluded.revision;",
    "END",
    "$tsql$;",
  ].join("\n");
}
