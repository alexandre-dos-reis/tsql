-- The SQL this case must compile to: each block below (blocks are separated by a
-- blank line) must appear in the compiler's output, in order, as consecutive lines,
-- indentation aside. Only the types and functions are listed, without the type
-- guard's boilerplate or the provenance comments, so this file is not runnable on its own.

expected text[] := ARRAY['limit integer', 'used integer'];

IF to_regtype('app.quota') IS NULL THEN
  CREATE TYPE app.quota AS (
    "limit" integer,
    used integer
  );

RETURN (quota)."limit" - (quota).used;
