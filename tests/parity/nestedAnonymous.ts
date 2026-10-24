/**
 * The outer type is named; only the inner shape is anonymous, and flattens to a prefixed column.
 */
type Envelope = {
  foo: { bar: string };
};

export function innerBar(nested: Envelope): string {
  return nested.foo.bar;
}

/** The SQL this case must compile to: each block appears, in this order, as written. */
export const sqlExpected = `
IF to_regtype('app.envelope') IS NULL THEN
  CREATE TYPE app.envelope AS (
    foo_bar text
  );

CREATE OR REPLACE FUNCTION app.inner_bar(
  nested app.envelope
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  RETURN (nested).foo_bar;
END;
$$;
`;
