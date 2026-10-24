/**
 * The mutation case, written so both languages agree: build a new value, do not mutate.
 */
type Mutable = {
  foo: { bar: string };
};

export function overwrite(nested: Mutable): string {
  const next: Mutable = { ...nested, foo: { ...nested.foo, bar: "some" } };
  return next.foo.bar;
}

/** The SQL this case must compile to: each block appears, in this order, as written. */
export const sqlExpected = `
IF to_regtype('app.mutable') IS NULL THEN
  CREATE TYPE app.mutable AS (
    foo_bar text
  );

CREATE OR REPLACE FUNCTION app.overwrite(
  nested app.mutable
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  next app.mutable;
BEGIN
  next := ROW('some')::app.mutable;
  RETURN (next).foo_bar;
END;
$$;
`;
