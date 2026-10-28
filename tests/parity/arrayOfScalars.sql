-- The SQL this case must compile to: each block below (blocks are separated by a
-- blank line) must appear in the compiler's output, in order, as consecutive lines,
-- indentation aside. Only the types and functions are listed, without the type
-- guard's boilerplate or the provenance comments, so this file is not runnable on its own.

CREATE OR REPLACE FUNCTION app.count_missing_notes(
  notes text[]
)
RETURNS integer
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  missing integer;
  note text;
BEGIN
  missing := 0;
  FOREACH note IN ARRAY notes LOOP
    IF note IS NULL THEN
      missing := missing + 1;
    END IF;
  END LOOP;
  RETURN missing;
END;
$$;

CREATE OR REPLACE FUNCTION app.has_missing_note(
  notes text[]
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
RETURN array_position(notes, NULL) IS NOT NULL;

CREATE OR REPLACE FUNCTION app.has_score(
  scores double precision[],
  score integer
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
RETURN array_position(scores, score::double precision) IS NOT NULL;

CREATE OR REPLACE FUNCTION app.item_count(
  items integer[]
)
RETURNS integer
LANGUAGE sql
IMMUTABLE
RETURN cardinality(items);

CREATE OR REPLACE FUNCTION app.largest_quantity(
  quantities integer[]
)
RETURNS integer
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  largest integer;
  quantity integer;
BEGIN
  largest := 0;
  FOREACH quantity IN ARRAY quantities LOOP
    IF quantity > largest THEN
      largest := quantity;
    END IF;
  END LOOP;
  RETURN largest;
END;
$$;

CREATE OR REPLACE FUNCTION app.offers_plan(
  plans app.offer[],
  plan app.offer
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
RETURN array_position(plans, plan) IS NOT NULL;

CREATE OR REPLACE FUNCTION app.sum_until_negative(
  amounts integer[]
)
RETURNS integer
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  total integer;
  amount integer;
BEGIN
  total := 0;
  FOREACH amount IN ARRAY amounts LOOP
    IF amount < 0 THEN
      EXIT;
    END IF;
    IF amount % 2 = 0 THEN
      CONTINUE;
    END IF;
    total := total + amount;
  END LOOP;
  RETURN total;
END;
$$;
