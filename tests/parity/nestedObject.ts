/**
 * A named nested type flattens the same way, into one type. `outer` is a keyword PostgreSQL accepts as
 * a parameter name but not as a column reference, so it is quoted everywhere.
 */
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
