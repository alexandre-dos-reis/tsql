-- The SQL this case must compile to: each block below (blocks are separated by a
-- blank line) must appear in the compiler's output, in order, as consecutive lines,
-- indentation aside. Only the types and functions are listed, without the type
-- guard's boilerplate or the provenance comments, so this file is not runnable on its own.

CREATE OR REPLACE FUNCTION app.discounted(
  tier app.tier,
  amount integer
)
RETURNS integer
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  off integer;
BEGIN
  CASE tier
    WHEN 'free', 'starter' THEN
      off := 5;
      RETURN amount - off;
    ELSE
      RETURN amount;
  END CASE;
END;
$$;

CREATE OR REPLACE FUNCTION app.shipping_cents(
  region app.region,
  weight_grams integer
)
RETURNS integer
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  base integer;
BEGIN
  CASE region
    WHEN 'eu', 'us' THEN
      base := 500;
      RETURN base + weight_grams * 2;
    WHEN 'apac' THEN
      IF weight_grams > 1000 THEN
        RETURN 4000;
      END IF;
      RETURN 2500;
    ELSE
      RETURN 9999;
  END CASE;
END;
$$;
