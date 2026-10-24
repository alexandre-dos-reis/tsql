/**
 * A named nested type flattens the same way, into one type. `outer` is a keyword PostgreSQL accepts as
 * a parameter name but not as a column reference, so it is quoted everywhere.
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

/** The SQL this case must compile to: each block appears, in this order, as written. */
export const sqlExpected = `
IF to_regtype('app."outer"') IS NULL THEN
  CREATE TYPE app."outer" AS (
    label text,
    inner_count double precision
  );

CREATE OR REPLACE FUNCTION app.is_big(
  "outer" app."outer"
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  RETURN ("outer").inner_count > 10 AND ("outer").label <> '';
END;
$$;
`;
