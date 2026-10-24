/**
 * A nested group cannot be passed as a value once flattened, but spreading it into a literal rebuilds
 * it.
 */
type Content = { bar: string };
type Crate = { foo: Content };

export function barOf(content: Content): string {
  return content.bar;
}

export function outerBar(crate: Crate): string {
  return barOf({ ...crate.foo });
}

/** The SQL this case must compile to: each block appears, in this order, as written. */
export const sqlExpected = `
IF to_regtype('app.content') IS NULL THEN
  CREATE TYPE app.content AS (
    bar text
  );

IF to_regtype('app.crate') IS NULL THEN
  CREATE TYPE app.crate AS (
    foo_bar text
  );

CREATE OR REPLACE FUNCTION app.bar_of(
  content app.content
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  RETURN (content).bar;
END;
$$;

CREATE OR REPLACE FUNCTION app.outer_bar(
  crate app.crate
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  RETURN app.bar_of(ROW((crate).foo_bar)::app.content);
END;
$$;
`;
