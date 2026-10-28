-- The SQL this case must compile to: each block below (blocks are separated by a
-- blank line) must appear in the compiler's output, in order, as consecutive lines,
-- indentation aside. Only the types and functions are listed, without the type
-- guard's boilerplate or the provenance comments, so this file is not runnable on its own.

IF to_regtype('app.basket_customer') IS NULL THEN
  CREATE TYPE app.basket_customer AS (
    tier text
  );

IF to_regtype('app.basket_line') IS NULL THEN
  CREATE TYPE app.basket_line AS (
    sku text,
    quantity integer,
    unit_cents integer
  );

-- The columns holding composites are expected through format_type, like the catalogue's side.

expected text[] := ARRAY['customer ' || format_type(to_regtype('app.basket_customer'), NULL), 'lines ' || format_type(to_regtype('app.basket_line[]'), NULL), 'tags ' || format_type(to_regtype('app.tag[]'), NULL)];

IF to_regtype('app.basket') IS NULL THEN
  CREATE TYPE app.basket AS (
    customer app.basket_customer,
    lines app.basket_line[],
    tags app.tag[]
  );

FOREACH line IN ARRAY lines LOOP
  total := total + (line).quantity % 100 * ((line).unit_cents % 1000);
END LOOP;

RETURN app.lines_total_cents((basket).lines);

CREATE OR REPLACE FUNCTION app.biggest_line(
  basket app.basket
)
RETURNS integer
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  lines app.basket_line[];
  biggest integer;
  line app.basket_line;
BEGIN
  lines := (basket).lines;
  biggest := 0;
  FOREACH line IN ARRAY lines LOOP
    IF (line).quantity > biggest THEN
      biggest := (line).quantity;
    END IF;
  END LOOP;
  RETURN biggest;
END;
$$;

RETURN array_position((basket).tags, 'gift') IS NOT NULL;

lines := (basket).lines;
RETURN cardinality(lines);

RETURN ROW(ROW('gold')::app.basket_customer, (basket).lines, (basket).tags)::app.basket;
