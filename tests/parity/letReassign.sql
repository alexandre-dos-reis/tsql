-- The SQL this case must compile to: each block below (blocks are separated by a
-- blank line) must appear in the compiler's output, in order, as consecutive lines,
-- indentation aside. Only the types and functions are listed, without the type
-- guard's boilerplate or the provenance comments, so this file is not runnable on its own.

CREATE OR REPLACE FUNCTION app.member_price(
  price double precision,
  member boolean
)
RETURNS double precision
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  p double precision;
BEGIN
  p := price;
  IF member THEN
    p := p - p / 10;
  END IF;
  RETURN p;
END;
$$;

CREATE OR REPLACE FUNCTION app.shipping_total(
  weight integer,
  express boolean
)
RETURNS integer
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  total integer;
BEGIN
  total := 500;
  IF weight > 1000 THEN
    total := total + 200;
  END IF;
  IF express THEN
    total := total * 2;
  END IF;
  total := total + 1;
  RETURN total;
END;
$$;
