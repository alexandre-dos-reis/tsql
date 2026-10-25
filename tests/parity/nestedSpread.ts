/**
 * A nested object rebuilt with spreads and returned: a `ROW` inside a `ROW`.
 */
type Leaf = { bar: string };
type Nested = {
  foo: Leaf;
};

export function someNestedAssignment(nested: Nested): Nested {
  const _nested: Nested = { ...nested, foo: { ...nested.foo, bar: "some" } };
  return _nested;
}
