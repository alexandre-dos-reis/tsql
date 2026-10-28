-- The SQL this case must compile to: each block below (blocks are separated by a
-- blank line) must appear in the compiler's output, in order, as consecutive lines,
-- indentation aside. Only the types and functions are listed, without the type
-- guard's boilerplate or the provenance comments, so this file is not runnable on its own.

IF to_regtype('app."inner"') IS NULL THEN
  CREATE TYPE app."inner" AS (
    count double precision
  );

expected text[] := ARRAY['label text', 'inner ' || format_type(to_regtype('app."inner"'), NULL)];

IF to_regtype('app."outer"') IS NULL THEN
  CREATE TYPE app."outer" AS (
    label text,
    "inner" app."inner"
  );

CREATE OR REPLACE FUNCTION app.inner_of(
  "outer" app."outer"
)
RETURNS app."inner"
LANGUAGE sql
IMMUTABLE
RETURN ("outer")."inner";

CREATE OR REPLACE FUNCTION app.is_big(
  "outer" app."outer"
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
RETURN (("outer")."inner").count > 10 AND (("outer")."inner").count <> 'NaN'::double precision AND ("outer").label <> '';

