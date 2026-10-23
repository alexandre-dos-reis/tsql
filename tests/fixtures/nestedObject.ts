interface Inner {
  count: number;
}

interface Outer {
  inner: Inner;
}

export function isEmpty(outer: Outer): boolean {
  return outer.inner !== null;
}
