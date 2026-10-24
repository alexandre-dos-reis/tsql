/**
 * A named nested type flattens the same way, into one type. `outer` is a keyword PostgreSQL accepts as
 * a parameter name but not as a column reference, so it is quoted everywhere.
 *
 * Expected SQL: CREATE TYPE app."outer" AS (
 * Expected SQL: label text,
 * Expected SQL: inner_count double precision
 * Expected SQL: "outer" app."outer"
 * Expected SQL: RETURN ("outer").inner_count > 10
 */
interface Inner {
  count: number;
}

interface Outer {
  label: string;
  inner: Inner;
}

export function isBig(outer: Outer): boolean {
  return outer.inner.count > 10 && outer.label !== "";
}
