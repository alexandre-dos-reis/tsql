/**
 * `Integer` here is this file's own alias, not tsql's: it must map to the `number` it is, never to
 * `integer`.
 */
type Integer = number;

export function doubledWeight(weight: Integer): Integer {
  return weight * 2;
}

/** The SQL this case must compile to: each block appears, in this order, as written. */
export const sqlExpected = `
CREATE OR REPLACE FUNCTION app.doubled_weight(
  weight double precision
)
RETURNS double precision
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  RETURN weight * 2;
END;
$$;
`;
