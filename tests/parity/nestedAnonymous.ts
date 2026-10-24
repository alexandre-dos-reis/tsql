/**
 * The outer type is named; only the inner shape is anonymous, and flattens to a prefixed column.
 */
type Envelope = {
  foo: { bar: string };
};

export function innerBar(nested: Envelope): string {
  return nested.foo.bar;
}
