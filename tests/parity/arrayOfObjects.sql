-- The SQL this case must compile to: each block below (blocks are separated by a
-- blank line) must appear in the compiler's output, in order, as consecutive lines,
-- indentation aside. Only the types and functions are listed, without the type
-- guard's boilerplate or the provenance comments, so this file is not runnable on its own.

IF to_regtype('app.todo_item') IS NULL THEN
  CREATE TYPE app.todo_item AS (
    title text,
    done boolean,
    estimate integer
  );

CREATE OR REPLACE FUNCTION app.is_overloaded(
  todos app.todo_item[],
  "limit" integer
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  RETURN app.open_todo_count(todos) > "limit" % 5 OR cardinality(todos) = 10;
END;
$$;

CREATE OR REPLACE FUNCTION app.open_estimate(
  todos app.todo_item[]
)
RETURNS integer
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  total integer;
  todo app.todo_item;
  estimate integer;
BEGIN
  total := 0;
  FOREACH todo IN ARRAY todos LOOP
    IF (todo).done THEN
      CONTINUE;
    END IF;
    estimate := (todo).estimate;
    total := total + estimate;
  END LOOP;
  RETURN total;
END;
$$;

CREATE OR REPLACE FUNCTION app.open_todo_count(
  todos app.todo_item[]
)
RETURNS integer
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  remaining integer;
  todo app.todo_item;
BEGIN
  remaining := 0;
  FOREACH todo IN ARRAY todos LOOP
    IF NOT (todo).done THEN
      remaining := remaining + 1;
    END IF;
  END LOOP;
  RETURN remaining;
END;
$$;
