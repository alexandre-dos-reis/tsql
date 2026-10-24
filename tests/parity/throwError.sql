-- The SQL this case must compile to: each block below (blocks are separated by a
-- blank line) must appear in the compiler's output, in order, as consecutive lines,
-- indentation aside. Only the types and functions are listed, without the type
-- guard's boilerplate or the provenance comments, so this file is not runnable on its own.

IF percent > 90 THEN
  RAISE EXCEPTION '%', 'over 90% isn''t allowed';
END IF;
RETURN percent::double precision / 100;

RAISE EXCEPTION '%', '';

RAISE EXCEPTION '%', reason;

CREATE OR REPLACE FUNCTION app.seat_price(
  plan text,
  seats integer
)
RETURNS integer
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  IF seats < 0 THEN
    RAISE EXCEPTION '%', 'seats cannot be negative';
  END IF;
  CASE plan
    WHEN 'free' THEN
      RETURN 0;
    WHEN 'pro' THEN
      RETURN seats * 10;
    ELSE
      RAISE EXCEPTION '%', 'unknown plan';
  END CASE;
END;
$$;
