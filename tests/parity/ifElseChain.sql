-- The SQL this case must compile to: each block below (blocks are separated by a
-- blank line) must appear in the compiler's output, in order, as consecutive lines,
-- indentation aside. Only the types and functions are listed, without the type
-- guard's boilerplate or the provenance comments, so this file is not runnable on its own.

--   plan: one of 'enterprise', 'free', 'pro' (not enforced here)
CREATE OR REPLACE FUNCTION app.todo_limit(
  plan text
)
RETURNS integer
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  IF plan = 'free' THEN
    RETURN 3;
  ELSIF plan = 'pro' THEN
    RETURN 100;
  END IF;
  RETURN 1000;
END;
$$;
