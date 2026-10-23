/** The outer type is named; only the inner shape is anonymous. */
type Nested = {
  foo: { bar: string };
};

export function innerBar(nested: Nested): string {
  return nested.foo.bar;
}
