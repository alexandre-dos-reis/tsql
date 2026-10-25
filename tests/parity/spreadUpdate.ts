/**
 * The mutation case, written so both languages agree: build a new value, do not mutate.
 */
type MutableLeaf = { bar: string };
type Mutable = {
  foo: MutableLeaf;
};

export function overwrite(nested: Mutable): string {
  const next: Mutable = { ...nested, foo: { ...nested.foo, bar: "some" } };
  return next.foo.bar;
}
