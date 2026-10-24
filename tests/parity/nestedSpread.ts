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
