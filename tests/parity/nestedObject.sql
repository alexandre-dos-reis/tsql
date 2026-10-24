-- The SQL this case must compile to: each block below (blocks are separated by a
-- blank line) must appear in the compiler's output, in order, as consecutive lines,
-- indentation aside. Only the types and functions are listed, without the type
-- guard's boilerplate or the provenance comments, so this file is not runnable on its own.

IF to_regtype('app."outer"') IS NULL THEN
  CREATE TYPE app."outer" AS (
    label text,
    inner_count double precision
  );

CREATE OR REPLACE FUNCTION app.is_big(
  "outer" app."outer"
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  RETURN ("outer").inner_count > 10 AND ("outer").label <> '';
END;
$$;
