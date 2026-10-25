-- The SQL this case must compile to: each block below (blocks are separated by a
-- blank line) must appear in the compiler's output, in order, as consecutive lines,
-- indentation aside. Only the types and functions are listed, without the type
-- guard's boilerplate or the provenance comments, so this file is not runnable on its own.

RETURN CASE WHEN name = '' THEN 'nobody' ELSE 'hello ' || name END;

RETURN 'owner: ' || COALESCE(owner, 'none');

CREATE OR REPLACE FUNCTION app.plan_label(
  plan text,
  region text
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  RETURN plan || '-' || region;
END;
$$;

RETURN '"' || name || '" isn''t empty';

RETURN seats::text || ' seats (annual: ' || annual::text || ')';

RETURN (a + b)::text || '/' || (a * 2)::text;
