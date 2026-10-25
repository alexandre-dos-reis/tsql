-- The SQL this case must compile to: each block below (blocks are separated by a
-- blank line) must appear in the compiler's output, in order, as consecutive lines,
-- indentation aside. Only the types and functions are listed, without the type
-- guard's boilerplate or the provenance comments, so this file is not runnable on its own.

CREATE OR REPLACE FUNCTION app.plan_cap(
  plan app.plan
)
RETURNS integer
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  RETURN CASE WHEN plan = 'free' THEN 3 ELSE 100 END;
END;
$$;

CREATE OR REPLACE FUNCTION app.remaining_todos(
  plan app.plan,
  count integer
)
RETURNS integer
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  "limit" integer;
BEGIN
  "limit" := app.plan_cap(plan);
  IF count >= "limit" THEN
    RETURN 0;
  END IF;
  RETURN "limit" - count;
END;
$$;
