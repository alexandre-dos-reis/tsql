/**
 * A field of a named object type is a column of that type's own composite, as PostgreSQL nests them:
 * `inner: Inner` is `"inner" app."inner"`, created first, and `outer.inner.count` is
 * `(("outer")."inner").count`. `outer` and `inner` are keywords PostgreSQL accepts as names but not
 * as column references, so they are quoted everywhere.
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

export function innerOf(outer: Outer): Inner {
  return outer.inner;
}
