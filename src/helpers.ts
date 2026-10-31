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

import { HELPER_HASHES } from "./helpersLock";

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
 * JavaScript's StrWhiteSpace, as a bracket expression. Contiguous runs are
 * ranges — `\t-\r` is U+0009..U+000D, and U+2000..U+200A the general
 * punctuation spaces — which a regular expression understands and `ltrim`'s
 * character *set* does not. That is why the trim lives inside each pattern
 * rather than in a separate `ltrim` call: one construct instead of two, and the
 * class written once per pattern instead of once per call.
 */
const WHITESPACE = "\\t-\\r \\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff";

/** `substring` anchored past any leading whitespace. Schema-qualified, so two arguments and never `from`. */
const after = (pattern: string): string => `pg_catalog.substring(s, E'^[${WHITESPACE}]*${pattern}')`;

/** The longest prefix JavaScript would read in base ten: a sign and digits. NULL when there is none. */
const MATCHED = after("([+-]?[0-9]+)");
/**
 * The `0x` prefix with its sign, NULL when there is none. Detecting the prefix
 * is separate from reading the digits because JavaScript *commits* to base 16
 * on seeing it: `parseInt('0x')` and `parseInt('0xzz')` are NaN, not the 0 that
 * falling back to base ten would read off the leading zero.
 */
const HEX_PREFIX = after("([+-]?0[xX])");
/** The hexadecimal digits after that prefix, NULL when the prefix is followed by none. */
const HEX = after("[+-]?0[xX]([0-9a-fA-F]+)");

/**
 * Base ten, as a double. Short because the helper returns `integer`: a value
 * that will not fit has to raise, and `numeric::double precision` raising on
 * overflow — the thing the double-returning version had to work around — is now
 * exactly what is wanted. There is no `-0` case either, `integer` having no
 * negative zero, and no `Infinity` case, an infinity and a merely-too-large
 * value both being out of range. `COALESCE` rather than a `CASE` on NULL, so
 * the match is written once.
 */
const DECIMAL = `COALESCE(${MATCHED}::numeric, 'NaN'::${D})`;

/**
 * The value of the hexadecimal digits, leading zeros removed.
 *
 * No aggregate, so the helper inlines, and no length test either: nine
 * significant hexadecimal digits are already 16^8, past `integer`, so taking
 * the leading nine is enough to make the cast at the end raise for anything
 * longer — which is the answer. Eight or fewer are exact through `bit(64)`.
 * Without that, the digits would have to be written twice, once to measure and
 * once to convert. Measured at 1.0 µs a call against 15.2 µs for the aggregate
 * this replaced.
 *
 * NULL when there were no digits, which the `COALESCE` in the body turns into
 * the `NaN` JavaScript gives for `'0x'`.
 */
const HEX_VALUE = `('x' || pg_catalog.lpad(pg_catalog.left(pg_catalog.ltrim(${HEX}, '0'), 9), 16, '0'))::bit(64)::bigint::numeric`;
/** The sign as a factor, so the value is written once rather than once per sign. */
const HEX_SIGN = `CASE WHEN pg_catalog.left(${HEX_PREFIX}, 1) = '-' THEN -1 ELSE 1 END`;

/**
 * The longest prefix `parseFloat` reads: a sign, then `Infinity` or a decimal
 * literal — digits with an optional point, or a point and digits — and an
 * optional exponent, which is read only when it has digits (`'1e'` is 1). NULL
 * when there is none, and the point is a bracket expression rather than `\.`, so
 * nothing in the pattern needs escaping inside the `E'…'` literal.
 *
 * It is the whole of what has to be read: PostgreSQL's own `float8` input then
 * returns the same double JavaScript does for it — the same correctly rounded
 * result, `-0` included — so the helper never parses a digit itself.
 */
const LITERAL = after("([+-]?(?:Infinity|(?:[0-9]+[.]?[0-9]*|[.][0-9]+)(?:[eE][+-]?[0-9]+)?))");

/**
 * Can the `float8` input raise on this string? It raises where JavaScript gives
 * `±Infinity` or `±0`: a literal whose value is past the double range, or so
 * close to zero it rounds to nothing. Both need either many digits or a large
 * exponent, so this is true — the cast cannot raise — when the string is under
 * 200 bytes, which bounds the digits, and has no exponent of three digits or
 * more anywhere: the value is then below 10^299 and, unless it is zero, above
 * 10^-299, and the range is 10^±308 (10^-324 at the small end).
 *
 * Ordered so the common string pays for almost nothing: a string with no `e` or
 * `E` — most of them — is settled by two `strpos`, and the regular expression
 * runs only when there is one. The two `strpos` are cheaper than the pattern
 * alone, which is why they come first; the difference is a fraction of a µs a
 * call on PGlite, below what repeated runs agree on.
 */
const IN_RANGE =
  "pg_catalog.octet_length(s) < 200 AND (pg_catalog.strpos(s, 'e') + pg_catalog.strpos(s, 'E') = 0 " +
  "OR s !~ '[eE][+-]?[0-9]{3}')";

/**
 * `2^1024 - 2^970`, where a double rounds to infinity: the midpoint between the
 * largest double and `2^1024`, itself included — the tie goes to the even
 * neighbour, which is `2^1024`. In units of `2^-1075`, half the smallest double,
 * because that is what a `numeric` can say exactly: `2^-1075` itself comes out of
 * `numeric` division rounded, and a multiplication does not. A value is rounded
 * to zero when it is at most one such unit, the tie going to zero.
 */
const OVERFLOW = "2::numeric ^ 2099 - 2::numeric ^ 2045";

/** The literal's sign, NULL with the literal. Read from the text, because `numeric` has no `-0`. */
const LITERAL_SIGN = `(1 - 2 * (${LITERAL} LIKE '-%')::int)`;

/**
 * The magnitude of a literal that may be out of range, by what it is clamped to:
 * at most one unit is `0`, at least `OVERFLOW` is `Infinity`, and anything
 * between is in range, where the cast cannot raise and is exact.
 *
 * One `CASE` on a clamped value, rather than a comparison for each end, so the
 * literal is read once to decide — a `CASE` with a subject evaluates it once,
 * where two `WHEN` conditions would read the string twice. `GREATEST` and `LEAST`
 * skip a NULL, so no literal at all clamps to the lower end: its sign is NULL
 * too, and so is the product, which the `COALESCE` turns into `NaN`.
 */
const CLAMPED =
  `CASE LEAST(GREATEST(pg_catalog.abs(${LITERAL}::numeric) * 2::numeric ^ 1075, 1), ${OVERFLOW}) ` +
  `WHEN 1 THEN 0::${D} WHEN ${OVERFLOW} THEN 'Infinity'::${D} ELSE pg_catalog.abs(${LITERAL}::${D}) END`;

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
  // `Number.parseInt`, which the compiler only ever emits inside `int(...)`, so
  // the cast `int` stands for lives here and the helper returns `integer`
  // outright. The double is what the arithmetic produces — `NaN` for text with
  // no digits, an infinity past the double range — and casting it is what
  // raises, on exactly the values TypeScript's `int` throws on. The only other
  // thing the cast does, rounding a fraction, cannot arise: reading stops at the
  // `.`, so the value is always whole.
  //
  // The radix is a parameter, as it is in JavaScript, where an omitted one is 0
  // and means "read an `0x` prefix as hexadecimal". One helper rather than two
  // keeps the base-ten expression in one place and means no helper calls
  // another — which the migration could not order anyway, `runtimeSql` creating
  // them alphabetically and carrying only the ones its functions use.
  //
  // This is a parser, not a cast: `'12abc'::integer` would raise where
  // `parseInt` answers 12. Measured against V8 (`docs/design.md`,
  // "Number.parseInt", and `tests/parseIntValues.test.ts`).
  //
  // One `SELECT` with no `FROM`, so PostgreSQL inlines it — `HEX_VALUE` says why
  // the hexadecimal side needs no aggregate to stay exact.
  number_parse_int: {
    params: "s text, radix integer",
    signature: "text, integer",
    returns: "integer",
    body:
      `SELECT (CASE WHEN radix = 10 OR ${HEX_PREFIX} IS NULL THEN ${DECIMAL} ` +
      `ELSE COALESCE((${HEX_SIGN}) * (${HEX_VALUE}), 'NaN'::${D}) END)::integer`,
  },
  // `Number.parseFloat`: the prefix `LITERAL` reads, as the `float8` input
  // reads it. A string that cannot take the input to its limits is cast as it
  // is; one that can is clamped first (`CLAMPED`), because the input raises
  // past the double range where JavaScript answers `±Infinity`, and under the
  // smallest double where it answers `±0`. `NaN` for no literal at all.
  //
  // Unlike `number_parse_int` the answer is a `double precision`, so nothing
  // has to say what becomes of `NaN` or an infinity: they are values, as they
  // are in JavaScript, and no `int(...)` is involved.
  //
  // One `SELECT` with no `FROM`, so PostgreSQL inlines it. The common string
  // reads `s` through one pattern and one cast.
  number_parse_float: {
    params: "s text",
    signature: "text",
    returns: D,
    body: `SELECT COALESCE(CASE WHEN ${IN_RANGE} THEN ${LITERAL}::${D} ELSE ${LITERAL_SIGN} * ${CLAMPED} END, 'NaN'::${D})`,
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
