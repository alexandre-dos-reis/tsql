import fc from "fast-check";
import type { ManifestFunction } from "./compile.ts";
import { isArray, isScalar, type ArrayType, type CompositeType, type PgType, type ScalarType } from "./ir.ts";
import { quoteIdentifier } from "./names.ts";

/**
 * Parity checking: run identical inputs through the TypeScript function and the
 * generated database function and require the same answer.
 *
 * Nothing here is written per-rule — the inputs are derived from the manifest
 * the compiler emits, so every compiled function is covered automatically.
 */

/**
 * Executes `sql` with `params` and returns the single row it selects.
 *
 * A row rather than a scalar, because a function returning a composite is
 * queried one column per field — `(result).plan` — which hands back typed
 * values and avoids having to parse PostgreSQL's composite text format, where
 * `""`, NULL and the literal string `"null"` all look confusingly similar.
 */
export type RowQuery = (sql: string, params: readonly unknown[]) => Promise<Record<string, unknown>>;

/**
 * Integers are kept well inside int32 so that arithmetic cannot overflow:
 * PostgreSQL raises on integer overflow where TypeScript silently keeps going,
 * and that divergence is a documented limit rather than something to fuzz.
 */
const INT_BOUND = 1_000_000;
const FLOAT_BOUND = 1e9;

/**
 * Doubles are also kept away from the subnormal range. PostgreSQL raises
 * "value out of range: underflow" when a float8 result underflows to zero
 * (`5e-324 / 10`), where TypeScript quietly gives 0 — a documented divergence,
 * like integer overflow, rather than something to fuzz.
 */
const FLOAT_TINY = 1e-300;

/** NUL and lone surrogates are not representable in a PostgreSQL text value. */
const TEXT_UNSAFE = /[\u0000\uD800-\uDFFF]/u;

/**
 * Arrays are kept short: long enough for empty, single and repeated elements,
 * short enough that a rule looping over them stays fast.
 */
const ARRAY_MAX_LENGTH = 10;

export function arbitraryFor(type: PgType): fc.Arbitrary<unknown> {
  if (isArray(type)) return fc.array(arbitraryFor(type.element), { maxLength: ARRAY_MAX_LENGTH });
  const base = isScalar(type) ? scalarArbitrary(type) : compositeArbitrary(type);
  return type.nullable ? fc.option(base, { nil: null, freq: 4 }) : base;
}

/**
 * A composite parameter is an object on the TypeScript side, and the generated
 * object must have the *nested* shape the author wrote — the flattening to
 * columns only applies to the SQL side.
 */
function compositeArbitrary(type: CompositeType): fc.Arbitrary<unknown> {
  const leaves = type.fields.map((f) => arbitraryFor(f.type));
  return fc.tuple(...leaves).map((values) => {
    const root: Record<string, unknown> = {};
    type.fields.forEach((field, i) => assignPath(root, field.path, values[i]));
    return root;
  });
}

function assignPath(root: Record<string, unknown>, path: readonly string[], value: unknown): void {
  let node = root;
  for (const segment of path.slice(0, -1)) {
    node[segment] ??= {};
    node = node[segment] as Record<string, unknown>;
  }
  node[path[path.length - 1]!] = value;
}

function readPath(value: unknown, path: readonly string[]): unknown {
  let node: unknown = value;
  for (const segment of path) {
    if (node === null || node === undefined) return null;
    node = (node as Record<string, unknown>)[segment];
  }
  return node ?? null;
}

function scalarArbitrary(type: ScalarType): fc.Arbitrary<unknown> {
  switch (type.sql) {
    case "text":
      return type.allowed ? fc.constantFrom(...type.allowed) : fc.string().filter((s) => !TEXT_UNSAFE.test(s));
    case "integer":
      return fc.integer({ min: -INT_BOUND, max: INT_BOUND });
    case "numeric":
      return fc.integer({ min: -INT_BOUND, max: INT_BOUND }).map((n) => n / 100);
    case "double precision":
      return fc
        .double({ min: -FLOAT_BOUND, max: FLOAT_BOUND, noNaN: true })
        .filter((x) => x === 0 || Math.abs(x) >= FLOAT_TINY);
    case "boolean":
      return fc.boolean();
  }
}

/** A call of the generated function on one input: the query and its parameters. */
export interface PreparedCall {
  readonly sql: string;
  readonly params: readonly unknown[];
}

/**
 * Build the call for one input, the way a caller would write it by hand.
 *
 * Every placeholder is cast to its declared type: without that, PostgreSQL
 * cannot infer the type of a NULL argument. A composite is built from one
 * value per flattened field, read out of the nested TypeScript object, and cast
 * to the named type. An array is built element by element —
 * `ARRAY[$1::integer, $2::integer]::integer[]` — which is why the query depends
 * on the input: its length decides the placeholders. Building it in SQL also
 * leaves no array literal for a driver to escape. The three nest: a composite
 * with an array field holds an `ARRAY[ROW(…), …]`.
 *
 * A composite result is selected one column per field. An array — returned,
 * or a column of a composite — is selected as `to_jsonb(…)`, which both drivers parse, rather than in
 * PostgreSQL's array text format, where an array of composites is nested
 * quoting that would need a parser of its own.
 */
export function prepareCall(fn: ManifestFunction, schema: string | null, args: readonly unknown[]): PreparedCall {
  const qualify = (name: string) =>
    schema ? `${quoteIdentifier(schema)}.${quoteIdentifier(name)}` : quoteIdentifier(name);
  const arrayType = (type: ArrayType) =>
    `${isScalar(type.element) ? type.element.sql : qualify(type.element.sqlName)}[]`;

  const params: unknown[] = [];
  const value = (type: PgType, input: unknown): string => {
    if (isScalar(type)) {
      params.push(input);
      return `$${params.length}::${type.sql}`;
    }
    if (isArray(type)) {
      if (input === null || input === undefined) return `NULL::${arrayType(type)}`;
      const items = (input as readonly unknown[]).map((item) => value(type.element, item));
      return `ARRAY[${items.join(", ")}]::${arrayType(type)}`;
    }
    const fields = type.fields.map((f) => value(f.type, input === null ? null : readPath(input, f.path)));
    return `ROW(${fields.join(", ")})::${qualify(type.sqlName)}`;
  };

  const argsSql = fn.params.map((param, index) => value(param.type, args[index]));
  const call = `${qualify(fn.sqlName)}(${argsSql.join(", ")})`;
  if (isScalar(fn.returns)) return { sql: `select ${call} as value`, params };
  if (isArray(fn.returns)) return { sql: `select to_jsonb(${call}) as value`, params };

  const returns = fn.returns as CompositeType;
  const columns = returns.fields.map((f) => {
    const column = `(result).${quoteIdentifier(f.sqlName)}`;
    return isArray(f.type) ? `to_jsonb(${column}) as ${quoteIdentifier(f.sqlName)}` : column;
  });
  return { sql: `select ${columns.join(", ")} from (select ${call} as result) as call`, params };
}

/**
 * Compare a returned row against the TypeScript result: one column for a scalar
 * return, or field-by-field for a composite.
 */
export function resultEqual(row: Record<string, unknown>, tsValue: unknown, returns: PgType): boolean {
  if (isScalar(returns)) return valuesEqual(row.value, tsValue, returns);
  if (isArray(returns)) return jsonArrayEqual(row.value, tsValue, returns);
  return fieldsEqual(row, tsValue, returns);
}

/** Each field of a composite: a row from the database, or an object from `to_jsonb`. */
function fieldsEqual(record: Record<string, unknown>, tsValue: unknown, type: CompositeType): boolean {
  if (tsValue === null || tsValue === undefined) return false;
  return type.fields.every((field) => {
    const sqlValue = record[field.sqlName] ?? null;
    const expected = readPath(tsValue, field.path);
    return isArray(field.type) ? jsonArrayEqual(sqlValue, expected, field.type) : valuesEqual(sqlValue, expected, field.type);
  });
}

/** An array column as `to_jsonb` returns it, element by element. */
function jsonArrayEqual(json: unknown, tsValue: unknown, type: ArrayType): boolean {
  if (!Array.isArray(json) || !Array.isArray(tsValue) || json.length !== tsValue.length) return false;
  return json.every((item, i) =>
    isScalar(type.element)
      ? valuesEqual(item, tsValue[i], type.element)
      : item !== null && typeof item === "object" && fieldsEqual(item as Record<string, unknown>, tsValue[i], type.element),
  );
}

export function valuesEqual(sqlValue: unknown, tsValue: unknown, type: ScalarType): boolean {
  if (sqlValue === null || tsValue === null) return sqlValue === tsValue;

  switch (type.sql) {
    case "double precision": {
      const a = Number(sqlValue);
      const b = Number(tsValue);
      if (Object.is(a, b) || a === b) return true;
      // Both sides compute in IEEE-754 doubles, so results normally match
      // exactly; this tolerance only absorbs text round-tripping.
      const scale = Math.max(Math.abs(a), Math.abs(b), 1);
      return Math.abs(a - b) <= scale * Number.EPSILON * 4;
    }
    case "numeric":
      return Number(sqlValue) === Number(tsValue);
    default:
      return sqlValue === tsValue;
  }
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return Object.is(a, b);
  const [left, right] = [a as Record<string, unknown>, b as Record<string, unknown>];
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  return [...keys].every((key) => deepEqual(left[key], right[key]));
}

/** What one side did with an input: returned a value, or raised a message. */
type Outcome = { readonly value: unknown } | { readonly raised: string };

export interface ParityOptions {
  readonly runs?: number;
  readonly seed?: number;
}

/**
 * Property-check one function. Resolves when every generated input agrees;
 * rejects with fast-check's shrunk counterexample otherwise.
 */
export async function checkParity(
  fn: ManifestFunction,
  impl: (...args: never[]) => unknown,
  query: RowQuery,
  schema: string | null,
  options: ParityOptions = {},
): Promise<void> {
  const arbitraries = fn.params.map((p) => arbitraryFor(p.type));
  const call = impl as (...args: unknown[]) => unknown;

  // Each side either returns a value or raises. A `throw new Error(m)` compiles
  // to `RAISE EXCEPTION '%', m`, so raising agrees when both sides raise the
  // same message; anything else one side throws is a divergence.
  const typescript = (args: unknown[]): Outcome => {
    try {
      return { value: call(...args) };
    } catch (error) {
      if (error instanceof Error) return { raised: error.message };
      throw error;
    }
  };
  const database = async (args: unknown[]): Promise<Outcome> => {
    const prepared = prepareCall(fn, schema, args);
    try {
      return { value: await query(prepared.sql, prepared.params) };
    } catch (error) {
      return { raised: error instanceof Error ? error.message : String(error) };
    }
  };
  const agree = (ts: Outcome, sql: Outcome): boolean =>
    "raised" in ts || "raised" in sql
      ? "raised" in ts && "raised" in sql && ts.raised === sql.raised
      : resultEqual(sql.value as Record<string, unknown>, ts.value, fn.returns);

  const run = await fc.check(
    fc.asyncProperty(fc.tuple(...arbitraries), async (args) => {
      // Snapshot first: PL/pgSQL passes composites by value, so a TypeScript
      // function that mutates what it was given has an effect its SQL twin can
      // never reproduce. Comparing return values alone would not notice.
      const before = structuredClone(args);
      const ts = typescript(args);
      if (!deepEqual(args, before)) return false;
      return agree(ts, await database(args));
    }),
    { numRuns: options.runs ?? 200, ...(options.seed === undefined ? {} : { seed: options.seed }) },
  );

  if (!run.failed) return;

  // `fc.check` reports the shrunk input; replay it so the message names the two
  // answers that disagree rather than just the input that provoked it.
  const args = run.counterexample?.[0] ?? [];
  const { sql } = prepareCall(fn, schema, args);
  const before = structuredClone(args);
  const ts = typescript(args);
  let detail: string;
  if (!deepEqual(args, before)) {
    detail = `the TypeScript function mutated its arguments (${JSON.stringify(before)} -> ${JSON.stringify(args)}). PL/pgSQL passes composites by value, so the SQL function cannot do the same; build a new value instead`;
  } else {
    const db = await database(args);
    // A scalar or array return arrives as a one-column row; report the value, not the row.
    const show = (outcome: Outcome, side: string): string => {
      if ("raised" in outcome) return `${side} raised ${JSON.stringify(outcome.raised)}`;
      const row = outcome.value as Record<string, unknown>;
      const value = side === "PostgreSQL" ? (isScalar(fn.returns) || isArray(fn.returns) ? row.value : row) : outcome.value;
      return `${side} gave ${JSON.stringify(value)}`;
    };
    detail = `${show(ts, "TypeScript")}, ${show(db, "PostgreSQL")}`;
  }

  throw new Error(
    `${fn.tsName}(${args.map((a) => JSON.stringify(a)).join(", ")}) diverges: ${detail}` +
      `\n  ${fn.module} vs ${sql}` +
      `\n  reproduce with seed ${run.seed}, path ${run.counterexamplePath}`,
  );
}
