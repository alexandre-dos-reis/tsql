/**
 * A nullable discriminant keeps the simple CASE form: NULL matches no WHEN and reaches the ELSE, as
 * `null === "bob"` is false.
 */
export function greeting(name: string | null): string {
  switch (name) {
    case "bob":
      return "hi bob";
    default:
      return "hi";
  }
}

/** The SQL this case must compile to: each block appears, in this order, as written. */
export const sqlExpected = `
CREATE OR REPLACE FUNCTION app.greeting(
  name text
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  RETURN CASE name
    WHEN 'bob' THEN 'hi bob'
    ELSE 'hi'
  END;
END;
$$;
`;
