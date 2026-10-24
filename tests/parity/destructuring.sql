-- The SQL this case must compile to: each block below (blocks are separated by a
-- blank line) must appear in the compiler's output, in order, as consecutive lines,
-- indentation aside. Only the types and functions are listed, without the type
-- guard's boilerplate or the provenance comments, so this file is not runnable on its own.

CREATE TYPE app.purchase AS (
  plan text,
  quantity integer,
  shipping_country text,
  shipping_express boolean
);

CREATE OR REPLACE FUNCTION app.purchase_summary(
  purchase app.purchase
)
RETURNS integer
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  quantity integer;
  express boolean;
BEGIN
  quantity := (purchase).quantity;
  express := (purchase).shipping_express;
  RETURN CASE WHEN express THEN quantity + 1 ELSE quantity END;
END;
$$;

CREATE OR REPLACE FUNCTION app.purchase_plan(
  purchase app.purchase
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  tier text;
BEGIN
  tier := (purchase).plan;
  RETURN tier;
END;
$$;

CREATE OR REPLACE FUNCTION app.bonus_quantity(
  purchase app.purchase
)
RETURNS integer
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  destructured app.purchase;
  quantity integer;
BEGIN
  destructured := app.with_bonus(purchase);
  quantity := (destructured).quantity;
  RETURN quantity;
END;
$$;
