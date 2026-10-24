/**
 * A nested shape rebuilt with spreads and returned: flattened columns, one ROW.
 */
type Nested = {
  foo: { bar: string };
};

export function someNestedAssignment(nested: Nested): Nested {
  const _nested: Nested = { ...nested, foo: { ...nested.foo, bar: "some" } };
  return _nested;
}

/** The SQL this case must compile to: each block appears, in this order, as written. */
export const sqlExpected = `
IF to_regtype('app.nested') IS NULL THEN
  CREATE TYPE app.nested AS (
    foo_bar text
  );

CREATE OR REPLACE FUNCTION app.some_nested_assignment(
  nested app.nested
)
RETURNS app.nested
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  _nested app.nested;
BEGIN
  _nested := ROW('some')::app.nested;
  RETURN _nested;
END;
$$;
`;
