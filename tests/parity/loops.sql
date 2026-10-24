-- The SQL this case must compile to: each block below (blocks are separated by a
-- blank line) must appear in the compiler's output, in order, as consecutive lines,
-- indentation aside. Only the types and functions are listed, without the type
-- guard's boilerplate or the provenance comments, so this file is not runnable on its own.

CREATE OR REPLACE FUNCTION app.next_power_of_two(
  n integer
)
RETURNS integer
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  power integer;
BEGIN
  power := 1;
  WHILE power < n LOOP
    IF power > 1000000 THEN
      EXIT;
    END IF;
    power := power * 2;
  END LOOP;
  RETURN power;
END;
$$;

CREATE OR REPLACE FUNCTION app.sum_of_odds(
  n integer
)
RETURNS integer
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  "limit" integer;
  sum integer;
  i integer;
BEGIN
  "limit" := n % 50;
  sum := 0;
  i := 0;
  WHILE i < "limit" LOOP
    IF i % 2 = 0 THEN
      i := i + 1;
      CONTINUE;
    END IF;
    sum := sum + i;
    i := i + 1;
  END LOOP;
  RETURN sum;
END;
$$;

CREATE OR REPLACE FUNCTION app.triangle(
  n integer
)
RETURNS integer
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  "limit" integer;
  total integer;
  i integer;
  i_2 integer;
BEGIN
  "limit" := n % 20;
  total := 0;
  i := 1;
  WHILE i <= "limit" LOOP
    total := total + i;
    i := i + 1;
  END LOOP;
  i_2 := 0;
  WHILE i_2 < 2 LOOP
    total := total + 1;
    i_2 := i_2 + 1;
  END LOOP;
  RETURN total;
END;
$$;
