import fc from "fast-check";
import type { ManifestFunction } from "./compile.ts";
import { isScalar, type CompositeField, type CompositeType, type PgType, type ScalarType } from "./ir.ts";
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
 * queried as `(fn(...)).*` — which hands back one typed column per field and
 * avoids having to parse PostgreSQL's composite text format, where `""`, NULL
 * and the literal string `"null"` all look confusingly similar.
 */
export type RowQuery = (sql: string, params: readonly unknown[]) => Promise<Record<string, unknown>>;

/**
 * Integers are kept well inside int32 so that arithmetic cannot overflow:
 * PostgreSQL raises on integer overflow where TypeScript silently keeps going,
 * and that divergence is a documented limit rather than something to fuzz.
 */
const INT_BOUND = 1_000_000;
const FLOAT_BOUND = 1e9;

/** NUL and lone surrogates are not representable in a PostgreSQL text value. */
const TEXT_UNSAFE = /[\u0000\uD800-\uDFFF]/u;

export function arbitraryFor(type: PgType): fc.Arbitrary<unknown> {
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
      return fc.double({ min: -FLOAT_BOUND, max: FLOAT_BOUND, noNaN: true });
    case "boolean":
      return fc.boolean();
  }
}

/**
 * Placeholders are cast to the parameter's declared type: without that,
 * PostgreSQL cannot infer the type of a NULL argument.
 */
export function callSql(fn: ManifestFunction, schema: string | null): string {
  const qualify = (name: string) =>
    schema ? `${quoteIdentifier(schema)}.${quoteIdentifier(name)}` : quoteIdentifier(name);

  let placeholder = 0;
  const args = fn.params.map((param) => {
    if (isScalar(param.type)) return `$${++placeholder}::${param.type.sql}`;
    // A composite is built from one placeholder per field and cast to the
    // named type, which is how a caller would construct one by hand.
    const fields = param.type.fields.map((f: CompositeField) => `$${++placeholder}::${f.type.sql}`).join(", ");
    return `ROW(${fields})::${qualify(param.type.sqlName)}`;
  });

  const call = `${qualify(fn.sqlName)}(${args.join(", ")})`;
  // `(fn(...)).* ` expands a composite result into one column per field.
  return isScalar(fn.returns) ? `select ${call} as value` : `select (${call}).*`;
}

/**
 * Flatten the TypeScript-side arguments to match the placeholders in
 * {@link callSql}: an object argument becomes one value per field, in order.
 */
export function flattenArgs(fn: ManifestFunction, args: readonly unknown[]): unknown[] {
  const flat: unknown[] = [];
  fn.params.forEach((param, index) => {
    const value = args[index];
    if (isScalar(param.type)) {
      flat.push(value);
      return;
    }
    // One placeholder per flattened leaf, read out of the nested object.
    for (const field of param.type.fields) flat.push(value === null ? null : readPath(value, field.path));
  });
  return flat;
}

/**
 * Compare a returned row against the TypeScript result: one column for a scalar
 * return, or field-by-field for a composite.
 */
export function resultEqual(row: Record<string, unknown>, tsValue: unknown, returns: PgType): boolean {
  if (isScalar(returns)) return valuesEqual(row.value, tsValue, returns);
  if (tsValue === null || tsValue === undefined) return false;
  return returns.fields.every((field) => valuesEqual(row[field.sqlName], readPath(tsValue, field.path), field.type));
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
  const sql = callSql(fn, schema);
  const arbitraries = fn.params.map((p) => arbitraryFor(p.type));
  const call = impl as (...args: unknown[]) => unknown;

  const run = await fc.check(
    fc.asyncProperty(fc.tuple(...arbitraries), async (args) => {
      // Snapshot first: PL/pgSQL passes composites by value, so a TypeScript
      // function that mutates what it was given has an effect its SQL twin can
      // never reproduce. Comparing return values alone would not notice.
      const before = structuredClone(args);
      const tsValue = call(...args);
      if (!deepEqual(args, before)) return false;
      return resultEqual(await query(sql, flattenArgs(fn, args)), tsValue, fn.returns);
    }),
    { numRuns: options.runs ?? 200, ...(options.seed === undefined ? {} : { seed: options.seed }) },
  );

  if (!run.failed) return;

  // `fc.check` reports the shrunk input; replay it so the message names the two
  // answers that disagree rather than just the input that provoked it.
  const args = run.counterexample?.[0] ?? [];
  let detail: string;
  try {
    const before = structuredClone(args);
    const tsValue = call(...args);
    const row = await query(sql, flattenArgs(fn, args));
    // A scalar return arrives as a one-column row; report the value, not the row.
    const sqlValue = isScalar(fn.returns) ? row.value : row;
    detail = !deepEqual(args, before)
      ? `the TypeScript function mutated its arguments (${JSON.stringify(before)} -> ${JSON.stringify(args)}). PL/pgSQL passes composites by value, so the SQL function cannot do the same; build a new value instead`
      : `TypeScript gave ${JSON.stringify(tsValue)}, PostgreSQL gave ${JSON.stringify(sqlValue)}`;
  } catch (error) {
    // One side raising where the other does not is itself a divergence —
    // PostgreSQL's integer overflow being the obvious example.
    detail = `one side raised: ${String(error)}`;
  }

  throw new Error(
    `${fn.tsName}(${args.map((a) => JSON.stringify(a)).join(", ")}) diverges: ${detail}` +
      `\n  ${fn.module} vs ${sql}` +
      `\n  reproduce with seed ${run.seed}, path ${run.counterexamplePath}`,
  );
}
