type Inner = { bar: string };
type Outer = { foo: Inner };

export function barOf(inner: Inner): string {
  return inner.bar;
}

export function outerBar(outer: Outer): string {
  return barOf(outer.foo);
}
