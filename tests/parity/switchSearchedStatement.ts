/**
 * The searched form as a statement: `case null` with a branch that does more than return.
 */
export function describeCode(code: string | null): string {
  switch (code) {
    case null: {
      const word = "none";
      return word;
    }
    default:
      return "some";
  }
}

/** The SQL this case must compile to: each block appears, in this order, as written. */
export const sqlExpected = `
CREATE OR REPLACE FUNCTION app.describe_code(
  code text
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  word text;
BEGIN
  CASE
    WHEN code IS NULL THEN
      word := 'none';
      RETURN word;
    ELSE
      RETURN 'some';
  END CASE;
END;
$$;
`;
