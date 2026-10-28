-- The SQL this case must compile to: each block below (blocks are separated by a
-- blank line) must appear in the compiler's output, in order, as consecutive lines,
-- indentation aside. Only the types and functions are listed, without the type
-- guard's boilerplate or the provenance comments, so this file is not runnable on its own.

CREATE DOMAIN app.tier AS text CONSTRAINT tier_values CHECK (VALUE = ANY (ARRAY['enterprise', 'free', 'pro', 'starter']));

CREATE OR REPLACE FUNCTION app.seat_limit(
  tier app.tier
)
RETURNS integer
LANGUAGE sql
IMMUTABLE
RETURN CASE tier
  WHEN 'free' THEN 1
  WHEN 'starter' THEN 1
  WHEN 'pro' THEN 10
  ELSE 100
END;

