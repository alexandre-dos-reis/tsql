/**
 * A nested group cannot be passed as a value once flattened, but spreading it into a literal rebuilds
 * it.
 */
type Content = { bar: string };
type Crate = { foo: Content };

export function barOf(content: Content): string {
  return content.bar;
}

export function outerBar(crate: Crate): string {
  return barOf({ ...crate.foo });
}
