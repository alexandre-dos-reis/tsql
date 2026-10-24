/**
 * The outer type is named; only the inner shape is anonymous, and flattens to a prefixed column.
 *
 * Expected SQL: foo_bar text
 * Expected SQL: RETURN (nested).foo_bar;
 */
type Envelope = {
  foo: { bar: string };
};

export function innerBar(nested: Envelope): string {
  return nested.foo.bar;
}
