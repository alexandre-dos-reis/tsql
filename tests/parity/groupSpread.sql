-- The SQL this case must compile to: each block below (blocks are separated by a
-- blank line) must appear in the compiler's output, in order, as consecutive lines,
-- indentation aside. Only the types and functions are listed, without the type
-- guard's boilerplate or the provenance comments, so this file is not runnable on its own.

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
