-- The SQL this case must compile to: each block below (blocks are separated by a
-- blank line) must appear in the compiler's output, in order, as consecutive lines,
-- indentation aside. Only the types and functions are listed, without the type
-- guard's boilerplate or the provenance comments, so this file is not runnable on its own.

CREATE OR REPLACE FUNCTION app.is_not_a_number(
  x double precision
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
RETURN x <> x OR x = 'NaN'::double precision;

CREATE OR REPLACE FUNCTION app.literal_above(
  x double precision
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
RETURN 10 > x;

CREATE OR REPLACE FUNCTION app.nan_above(
  x double precision,
  y double precision
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
RETURN x > y AND x <> 'NaN'::double precision;

CREATE OR REPLACE FUNCTION app.nan_at_least(
  x double precision,
  y double precision
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
RETURN x >= y AND x <> 'NaN'::double precision;

CREATE OR REPLACE FUNCTION app.nan_at_most(
  x double precision,
  y double precision
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
RETURN x <= y AND y <> 'NaN'::double precision;

CREATE OR REPLACE FUNCTION app.nan_below(
  x double precision,
  y double precision
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
RETURN x < y AND y <> 'NaN'::double precision;

CREATE OR REPLACE FUNCTION app.nan_differs(
  x double precision,
  y double precision
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
RETURN x <> y OR x = 'NaN'::double precision;

CREATE OR REPLACE FUNCTION app.nan_equal(
  x double precision,
  y double precision
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
RETURN x = y AND x <> 'NaN'::double precision;

