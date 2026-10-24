/**
 * Rejected: assigning to a field of a parameter.
 *
 * This is not merely unsupported, it is untranslatable. The same assignment is
 * legal PL/pgSQL, but PL/pgSQL passes composites by value:
 *
 *     nested.foo_bar := 'some';  -- changes a local copy only
 *
 * In TypeScript the caller's object changes; in SQL the caller never sees it.
 * Build a new value instead: `const next: Mutable = { ...nested, foo: { bar: "some" } }`.
 */
type Mutable = {
  foo: { bar: string };
};

export function overwrite(nested: Mutable): string {
  nested.foo.bar = "some";
  return nested.foo.bar;
}
