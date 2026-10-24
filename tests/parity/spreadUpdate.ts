/**
 * The mutation case, written so both languages agree: build a new value, do not mutate.
 *
 * Expected SQL: next := ROW('some')::app.mutable;
 * Expected SQL: RETURN (next).foo_bar;
 */
type Mutable = {
  foo: { bar: string };
};

export function overwrite(nested: Mutable): string {
  const next: Mutable = { ...nested, foo: { ...nested.foo, bar: "some" } };
  return next.foo.bar;
}
