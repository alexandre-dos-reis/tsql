type Mutable = {
  foo: { bar: string };
};

export function overwrite(nested: Mutable): string {
  nested.foo.bar = "some";
  return nested.foo.bar;
}
