-- The SQL this case must compile to: each block below (blocks are separated by a
-- blank line) must appear in the compiler's output, in order, as consecutive lines,
-- indentation aside. Only the types and functions are listed, without the type
-- guard's boilerplate or the provenance comments, so this file is not runnable on its own.

CREATE OR REPLACE FUNCTION app.price_cents(
  list_cents integer,
  percent_off double precision
)
RETURNS double precision
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  discount double precision;
BEGIN
  discount := COALESCE(percent_off, 0);
  RETURN list_cents * (100 - discount) / 100;
END;
$$;
