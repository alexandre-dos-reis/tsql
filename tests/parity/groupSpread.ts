/**
 * A nested object is a value like any other: passed on as it is, or rebuilt by spreading it into a
 * literal.
 */
type Content = { bar: string };
type Crate = { foo: Content };

export function barOf(content: Content): string {
  return content.bar;
}

export function outerBar(crate: Crate): string {
  return barOf(crate.foo);
}

export function rebuiltBar(crate: Crate): string {
  return barOf({ ...crate.foo });
}
