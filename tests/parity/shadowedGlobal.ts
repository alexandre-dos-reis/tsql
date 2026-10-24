/**
 * A parameter may be named after a global: the check is provenance, not spelling.
 */
export function addOne(Math: number): number {
  return Math + 1;
}

/** The SQL this case must compile to: each block appears, in this order, as written. */
export const sqlExpected = `
CREATE OR REPLACE FUNCTION app.add_one(
  math double precision
)
RETURNS double precision
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  RETURN math + 1;
END;
$$;
`;
