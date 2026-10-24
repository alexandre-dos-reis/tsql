/**
 * Rejected: a nested object that may be null.
 *
 * Nested shapes are flattened into the parent's columns. A flattened group has no
 * way to be "absent": `foo: null` and `foo: { bar: null }` would both be stored as
 * `foo_bar = NULL`, two TypeScript values that SQL cannot tell apart.
 *
 * Expected: is an object that may be absent
 */
type MaybeInner = {
  foo: { bar: string } | null;
};

export function hasFoo(maybe: MaybeInner): boolean {
  return maybe.foo !== null;
}
