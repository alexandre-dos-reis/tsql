-- The SQL this case must compile to: each block below (blocks are separated by a
-- blank line) must appear in the compiler's output, in order, as consecutive lines,
-- indentation aside. Only the types and functions are listed, without the type
-- guard's boilerplate or the provenance comments, so this file is not runnable on its own.

CREATE OR REPLACE FUNCTION app.math_abs_float(
  x double precision
)
RETURNS double precision
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  RETURN abs(x);
END;
$$;

CREATE OR REPLACE FUNCTION app.math_abs_int(
  x integer
)
RETURNS integer
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  RETURN abs(x);
END;
$$;

CREATE OR REPLACE FUNCTION app.math_ceil(
  x double precision
)
RETURNS double precision
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  RETURN ceil(x);
END;
$$;

CREATE OR REPLACE FUNCTION app.math_clamp(
  x double precision,
  lo double precision,
  hi double precision
)
RETURNS double precision
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  RETURN tsql.math_min(tsql.math_max(x, lo), hi);
END;
$$;

CREATE OR REPLACE FUNCTION app.math_clz32(
  x integer
)
RETURNS integer
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  RETURN tsql.math_clz32(x);
END;
$$;

CREATE OR REPLACE FUNCTION app.math_floor(
  x double precision
)
RETURNS double precision
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  RETURN floor(x);
END;
$$;

CREATE OR REPLACE FUNCTION app.math_floor_int(
  x integer
)
RETURNS double precision
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  RETURN floor(x::double precision);
END;
$$;

CREATE OR REPLACE FUNCTION app.math_fround(
  x double precision
)
RETURNS double precision
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  RETURN tsql.math_fround(x);
END;
$$;

CREATE OR REPLACE FUNCTION app.math_imul(
  a integer,
  b integer
)
RETURNS integer
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  RETURN tsql.math_imul(a, b);
END;
$$;

CREATE OR REPLACE FUNCTION app.math_max(
  a double precision,
  b double precision
)
RETURNS double precision
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  RETURN tsql.math_max(a, b);
END;
$$;

CREATE OR REPLACE FUNCTION app.math_max_of_three(
  a double precision,
  b double precision,
  c double precision
)
RETURNS double precision
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  RETURN tsql.math_max(tsql.math_max(a, abs(b)), c);
END;
$$;

CREATE OR REPLACE FUNCTION app.math_min_float(
  a double precision,
  b double precision
)
RETURNS double precision
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  RETURN tsql.math_min(a, b);
END;
$$;

CREATE OR REPLACE FUNCTION app.math_min_int(
  a integer,
  b integer
)
RETURNS integer
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  RETURN least(a, b);
END;
$$;

CREATE OR REPLACE FUNCTION app.math_min_mixed(
  a integer,
  b double precision
)
RETURNS double precision
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  RETURN tsql.math_min(tsql.math_min(a::double precision, b), 10);
END;
$$;

CREATE OR REPLACE FUNCTION app.math_min_of_three(
  a double precision,
  b double precision,
  c double precision
)
RETURNS double precision
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  RETURN tsql.math_min(tsql.math_min(a, abs(b)), c);
END;
$$;

CREATE OR REPLACE FUNCTION app.math_round(
  x double precision
)
RETURNS double precision
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  RETURN tsql.math_round(x);
END;
$$;

CREATE OR REPLACE FUNCTION app.math_round_abs(
  a double precision
)
RETURNS double precision
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  RETURN tsql.math_round(abs(a));
END;
$$;

CREATE OR REPLACE FUNCTION app.math_round_called(
  a double precision
)
RETURNS double precision
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  RETURN tsql.math_round(app.math_abs_float(a));
END;
$$;

CREATE OR REPLACE FUNCTION app.math_sign(
  x double precision
)
RETURNS double precision
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  RETURN tsql.math_sign(x);
END;
$$;

CREATE OR REPLACE FUNCTION app.math_sqrt(
  x double precision
)
RETURNS double precision
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  RETURN tsql.math_sqrt(x);
END;
$$;

CREATE OR REPLACE FUNCTION app.math_trunc(
  x double precision
)
RETURNS double precision
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  RETURN trunc(x);
END;
$$;

CREATE OR REPLACE FUNCTION app.math_widest(
  a integer,
  b double precision
)
RETURNS double precision
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  RETURN tsql.math_max(tsql.math_max(a::double precision, b), 0);
END;
$$;
