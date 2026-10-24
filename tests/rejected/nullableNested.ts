type MaybeInner = {
  foo: { bar: string } | null;
};

export function hasFoo(maybe: MaybeInner): boolean {
  return maybe.foo !== null;
}
