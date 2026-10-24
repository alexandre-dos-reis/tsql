/**
 * Rejected: passing a nested group as a value (`outer.foo`).
 *
 * Once flattened, `outer.foo` is not a column but a set of columns
 * (`foo_bar`, …), so there is no single value to pass. Reference a leaf
 * (`outer.foo.bar`), or rebuild the group explicitly: `barOf({ ...outer.foo })`.
 *
 * Expected: `outer.foo` is a nested shape, not a value. Reference a leaf instead: `outer.foo.bar`
 */
type Inner = { bar: string };
type Outer = { foo: Inner };

export function barOf(inner: Inner): string {
  return inner.bar;
}

export function outerBar(outer: Outer): string {
  return barOf(outer.foo);
}
