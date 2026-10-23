type Deep = {
  a: { b: { c: { d: { e: string } } } };
};

export function deepValue(deep: Deep): string {
  return deep.a.b.c.d.e;
}
