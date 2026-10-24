-- The SQL this case must compile to: each block below (blocks are separated by a
-- blank line) must appear in the compiler's output, in order, as consecutive lines,
-- indentation aside. Only the types and functions are listed, without the type
-- guard's boilerplate or the provenance comments, so this file is not runnable on its own.

--   tier: one of 'enterprise', 'free', 'pro', 'starter' (not enforced here)
CREATE OR REPLACE FUNCTION app.seat_limit(
  tier text
)
RETURNS integer
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  RETURN CASE tier
    WHEN 'free' THEN 1
    WHEN 'starter' THEN 1
    WHEN 'pro' THEN 10
    ELSE 100
  END;
END;
$$;
