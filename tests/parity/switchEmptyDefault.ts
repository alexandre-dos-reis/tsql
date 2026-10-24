import type { Integer } from "../../src/pgtypes";

/**
 * A computed discriminant is evaluated once, by the CASE itself; an empty `default` becomes `ELSE
 * NULL;`.
 */
export function bucket(n: Integer): string {
  switch (n % 3) {
    case 0:
      return "fizz";
    default:
      break;
  }
  return "plain";
}

/** The SQL this case must compile to: each block appears, in this order, as written. */
export const sqlExpected = `
CREATE OR REPLACE FUNCTION app.bucket(
  n integer
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  CASE n % 3
    WHEN 0 THEN
      RETURN 'fizz';
    ELSE
      NULL;
  END CASE;
  RETURN 'plain';
END;
$$;
`;
