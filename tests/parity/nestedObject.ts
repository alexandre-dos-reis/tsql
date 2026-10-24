interface Inner {
  count: number;
}

interface Outer {
  label: string;
  inner: Inner;
}

export function isBig(outer: Outer): boolean {
  return outer.inner.count > 10 && outer.label !== "";
}
