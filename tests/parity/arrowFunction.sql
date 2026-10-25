-- The SQL this case must compile to: each block below (blocks are separated by a
-- blank line) must appear in the compiler's output, in order, as consecutive lines,
-- indentation aside. Only the types and functions are listed, without the type
-- guard's boilerplate or the provenance comments, so this file is not runnable on its own.

CREATE OR REPLACE FUNCTION app.grade_points(
  grade app.grade
)
RETURNS integer
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  RETURN CASE WHEN grade = 'a' THEN 3 ELSE 1 END;
END;
$$;

CREATE OR REPLACE FUNCTION app.passes(
  grade app.grade,
  bonus integer
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  total integer;
BEGIN
  total := app.grade_points(grade) + bonus;
  RETURN total >= 2;
END;
$$;
