-- The SQL this case must compile to: each block below (blocks are separated by a
-- blank line) must appear in the compiler's output, in order, as consecutive lines,
-- indentation aside. Only the types and functions are listed, without the type
-- guard's boilerplate or the provenance comments, so this file is not runnable on its own.

CREATE OR REPLACE FUNCTION app.math_abs_float(
  x double precision
)
RETURNS double precision
LANGUAGE sql
IMMUTABLE
RETURN abs(x);

CREATE OR REPLACE FUNCTION app.math_abs_int(
  x integer
)
RETURNS integer
LANGUAGE sql
IMMUTABLE
RETURN abs(x);

CREATE OR REPLACE FUNCTION app.math_ceil(
  x double precision
)
RETURNS double precision
LANGUAGE sql
IMMUTABLE
RETURN ceil(x);

CREATE OR REPLACE FUNCTION app.math_clamp(
  x double precision,
  lo double precision,
  hi double precision
)
RETURNS double precision
LANGUAGE sql
IMMUTABLE
RETURN tsql.math_min(tsql.math_max(x, lo), hi);

CREATE OR REPLACE FUNCTION app.math_clz32(
  x integer
)
RETURNS integer
LANGUAGE sql
IMMUTABLE
RETURN tsql.math_clz32(x);

CREATE OR REPLACE FUNCTION app.math_floor(
  x double precision
)
RETURNS double precision
LANGUAGE sql
IMMUTABLE
RETURN floor(x);

CREATE OR REPLACE FUNCTION app.math_floor_int(
  x integer
)
RETURNS double precision
LANGUAGE sql
IMMUTABLE
RETURN floor(x::double precision);

CREATE OR REPLACE FUNCTION app.math_fround(
  x double precision
)
RETURNS double precision
LANGUAGE sql
IMMUTABLE
RETURN tsql.math_fround(x);

CREATE OR REPLACE FUNCTION app.math_imul(
  a integer,
  b integer
)
RETURNS integer
LANGUAGE sql
IMMUTABLE
RETURN tsql.math_imul(a, b);

CREATE OR REPLACE FUNCTION app.math_max(
  a double precision,
  b double precision
)
RETURNS double precision
LANGUAGE sql
IMMUTABLE
RETURN tsql.math_max(a, b);

CREATE OR REPLACE FUNCTION app.math_max_of_three(
  a double precision,
  b double precision,
  c double precision
)
RETURNS double precision
LANGUAGE sql
IMMUTABLE
RETURN tsql.math_max(tsql.math_max(a, abs(b)), c);

CREATE OR REPLACE FUNCTION app.math_min_float(
  a double precision,
  b double precision
)
RETURNS double precision
LANGUAGE sql
IMMUTABLE
RETURN tsql.math_min(a, b);

CREATE OR REPLACE FUNCTION app.math_min_int(
  a integer,
  b integer
)
RETURNS integer
LANGUAGE sql
IMMUTABLE
RETURN least(a, b);

CREATE OR REPLACE FUNCTION app.math_min_mixed(
  a integer,
  b double precision
)
RETURNS double precision
LANGUAGE sql
IMMUTABLE
RETURN tsql.math_min(tsql.math_min(a::double precision, b), 10);

CREATE OR REPLACE FUNCTION app.math_min_of_three(
  a double precision,
  b double precision,
  c double precision
)
RETURNS double precision
LANGUAGE sql
IMMUTABLE
RETURN tsql.math_min(tsql.math_min(a, abs(b)), c);

CREATE OR REPLACE FUNCTION app.math_round(
  x double precision
)
RETURNS double precision
LANGUAGE sql
IMMUTABLE
RETURN tsql.math_round(x);

CREATE OR REPLACE FUNCTION app.math_round_abs(
  a double precision
)
RETURNS double precision
LANGUAGE sql
IMMUTABLE
RETURN tsql.math_round(abs(a));

CREATE OR REPLACE FUNCTION app.math_round_called(
  a double precision
)
RETURNS double precision
LANGUAGE sql
IMMUTABLE
RETURN tsql.math_round(app.math_abs_float(a));

CREATE OR REPLACE FUNCTION app.math_sign(
  x double precision
)
RETURNS double precision
LANGUAGE sql
IMMUTABLE
RETURN tsql.math_sign(x);

CREATE OR REPLACE FUNCTION app.math_sqrt(
  x double precision
)
RETURNS double precision
LANGUAGE sql
IMMUTABLE
RETURN tsql.math_sqrt(x);

CREATE OR REPLACE FUNCTION app.math_trunc(
  x double precision
)
RETURNS double precision
LANGUAGE sql
IMMUTABLE
RETURN trunc(x);

CREATE OR REPLACE FUNCTION app.math_widest(
  a integer,
  b double precision
)
RETURNS double precision
LANGUAGE sql
IMMUTABLE
RETURN tsql.math_max(tsql.math_max(a::double precision, b), 0);

