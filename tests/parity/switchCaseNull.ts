/**
 * `case null` needs the searched CASE form, `WHEN code IS NULL`, with nullable equality for the other
 * labels.
 */
export function label(code: string | null): string {
  switch (code) {
    case null:
      return "none";
    case "a":
      return "alpha";
    default:
      return "other";
  }
}

/** The SQL this case must compile to: each block appears, in this order, as written. */
export const sqlExpected = `
CREATE OR REPLACE FUNCTION app.label(
  code text
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  RETURN CASE
    WHEN code IS NULL THEN 'none'
    WHEN code IS NOT DISTINCT FROM 'a' THEN 'alpha'
    ELSE 'other'
  END;
END;
$$;
`;
