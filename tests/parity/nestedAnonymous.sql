-- The SQL this case must compile to: each block below (blocks are separated by a
-- blank line) must appear in the compiler's output, in order, as consecutive lines,
-- indentation aside. Only the types and functions are listed, without the type
-- guard's boilerplate or the provenance comments, so this file is not runnable on its own.

IF to_regtype('app.envelope') IS NULL THEN
  CREATE TYPE app.envelope AS (
    foo_bar text
  );

CREATE OR REPLACE FUNCTION app.inner_bar(
  nested app.envelope
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  RETURN (nested).foo_bar;
END;
$$;
