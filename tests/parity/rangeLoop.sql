CREATE OR REPLACE FUNCTION app.range_empty(
  n integer
)
RETURNS integer
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  seen integer;
BEGIN
  seen := 0;
  FOR i IN n % 10..0 LOOP
    seen := seen + i;
  END LOOP;
  RETURN seen;
END;
$$;

CREATE OR REPLACE FUNCTION app.range_first_odd(
  n integer
)
RETURNS integer
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  found integer;
BEGIN
  found := -1;
  FOR i IN 1..n % 50 LOOP
    IF i % 2 = 0 THEN
      CONTINUE;
    END IF;
    found := i;
    EXIT;
  END LOOP;
  RETURN found;
END;
$$;

CREATE OR REPLACE FUNCTION app.range_sum(
  n integer
)
RETURNS integer
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  total integer;
BEGIN
  total := 0;
  FOR i IN 1..n % 100 LOOP
    total := total + i;
  END LOOP;
  RETURN total;
END;
$$;
