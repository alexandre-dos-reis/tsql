type Clashing = {
  foo: { bar: string };
  fooBar: string;
};

export function pick(clashing: Clashing): string {
  return clashing.fooBar;
}
