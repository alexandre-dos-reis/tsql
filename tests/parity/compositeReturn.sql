-- The SQL this case must compile to: each block below (blocks are separated by a
-- blank line) must appear in the compiler's output, in order, as consecutive lines,
-- indentation aside. Only the types and functions are listed, without the type
-- guard's boilerplate or the provenance comments, so this file is not runnable on its own.

IF to_regtype('app.plan_record') IS NULL THEN
  CREATE TYPE app.plan_record AS (
    name text,
    seats double precision
  );

CREATE OR REPLACE FUNCTION app.echo_plan(
  plan app.plan_record
)
RETURNS app.plan_record
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  RETURN plan;
END;
$$;
