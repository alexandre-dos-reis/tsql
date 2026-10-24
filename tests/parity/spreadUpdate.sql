-- The SQL this case must compile to: each block below (blocks are separated by a
-- blank line) must appear in the compiler's output, in order, as consecutive lines,
-- indentation aside. Only the types and functions are listed, without the type
-- guard's boilerplate or the provenance comments, so this file is not runnable on its own.

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
