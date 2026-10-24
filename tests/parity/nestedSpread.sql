-- The SQL this case must compile to: each block below (blocks are separated by a
-- blank line) must appear in the compiler's output, in order, as consecutive lines,
-- indentation aside. Only the types and functions are listed, without the type
-- guard's boilerplate or the provenance comments, so this file is not runnable on its own.

IF to_regtype('app.nested') IS NULL THEN
  CREATE TYPE app.nested AS (
    foo_bar text
  );

CREATE OR REPLACE FUNCTION app.some_nested_assignment(
  nested app.nested
)
RETURNS app.nested
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  _nested app.nested;
BEGIN
  _nested := ROW('some')::app.nested;
  RETURN _nested;
END;
$$;
