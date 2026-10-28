-- The SQL this case must compile to: each block below (blocks are separated by a
-- blank line) must appear in the compiler's output, in order, as consecutive lines,
-- indentation aside. Only the types and functions are listed, without the type
-- guard's boilerplate or the provenance comments, so this file is not runnable on its own.

CREATE TYPE app.language_level AS ENUM ('low', 'high');

-- The first three are SQL functions, `languageCaller` created after the `languageLeaf` it calls; the rest stay PL/pgSQL.

CREATE OR REPLACE FUNCTION app.language_above(
  x double precision
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
RETURN x > 990 AND x <> 'NaN'::double precision;

CREATE OR REPLACE FUNCTION app.language_leaf(
  x double precision
)
RETURNS double precision
LANGUAGE sql
IMMUTABLE
RETURN x * 2;

CREATE OR REPLACE FUNCTION app.language_caller(
  x double precision
)
RETURNS double precision
LANGUAGE sql
IMMUTABLE
RETURN app.language_leaf(x) + 1;

CREATE OR REPLACE FUNCTION app.language_even(
  n integer
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  RETURN CASE WHEN n < 0 OR n > 10 THEN n % 2 = 0 ELSE CASE WHEN n = 0 THEN true ELSE app.language_odd(n - 1) END END;
END;
$$;

CREATE OR REPLACE FUNCTION app.language_is_high(
  level app.language_level
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  RETURN level = 'high'::app.language_level;
END;
$$;

CREATE OR REPLACE FUNCTION app.language_loop(
  n integer
)
RETURNS integer
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  total integer;
  i integer;
BEGIN
  total := 0;
  i := 0;
  WHILE i < n LOOP
    total := total + i;
    i := i + 1;
  END LOOP;
  RETURN total;
END;
$$;

CREATE OR REPLACE FUNCTION app.language_odd(
  n integer
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  RETURN CASE WHEN n < 0 OR n > 10 THEN n % 2 <> 0 ELSE CASE WHEN n = 0 THEN false ELSE app.language_even(n - 1) END END;
END;
$$;
