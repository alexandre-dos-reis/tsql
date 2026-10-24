/**
 * `!==` on a nullable value becomes `IS DISTINCT FROM`, not `<>`.
 */
export function isNotEmpty(code: string | null): boolean {
  if (code === null) {
    return false;
  }
  return code !== "";
}

/** The SQL this case must compile to: each block appears, in this order, as written. */
export const sqlExpected = `
CREATE OR REPLACE FUNCTION app.is_not_empty(
  code text
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  IF code IS NULL THEN
    RETURN false;
  END IF;
  RETURN code IS DISTINCT FROM '';
END;
$$;
`;
