/**
 * A nested shape rebuilt with spreads and returned: flattened columns, one ROW.
 *
 * Expected SQL: CREATE TYPE app.nested AS (
 * Expected SQL: foo_bar text
 * Expected SQL: _nested := ROW('some')::app.nested;
 * Expected SQL: RETURN _nested;
 */
type Nested = {
  foo: { bar: string };
};

export function someNestedAssignment(nested: Nested): Nested {
  const _nested: Nested = { ...nested, foo: { ...nested.foo, bar: "some" } };
  return _nested;
}
