-- The SQL this case must compile to: each block below (blocks are separated by a
-- blank line) must appear in the compiler's output, in order, as consecutive lines,
-- indentation aside. Only the types and functions are listed, without the type
-- guard's boilerplate or the provenance comments, so this file is not runnable on its own.

IF to_regtype('app.todo_policy') IS NULL THEN
  CREATE TYPE app.todo_policy AS (
    plan text,
    current_count double precision
  );

CREATE OR REPLACE FUNCTION app.can_add_todo(
  policy app.todo_policy
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  RETURN (policy).plan <> 'free' OR (policy).current_count < 3;
END;
$$;
