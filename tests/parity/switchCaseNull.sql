-- The SQL this case must compile to: each block below (blocks are separated by a
-- blank line) must appear in the compiler's output, in order, as consecutive lines,
-- indentation aside. Only the types and functions are listed, without the type
-- guard's boilerplate or the provenance comments, so this file is not runnable on its own.

CREATE OR REPLACE FUNCTION app.label(
  code text
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  RETURN CASE
    WHEN code IS NULL THEN 'none'
    WHEN code IS NOT DISTINCT FROM 'a' THEN 'alpha'
    ELSE 'other'
  END;
END;
$$;
