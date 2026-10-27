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
  RETURN (SELECT CASE WHEN _tsql_1 = 0 AND hi = 0 THEN CASE WHEN atan2(_tsql_1, -1) < 0 OR atan2(hi, -1) < 0 THEN '-0'::double precision ELSE 0 END ELSE -greatest(-_tsql_1, -hi) END FROM (SELECT CASE WHEN x = 0 AND lo = 0 THEN CASE WHEN atan2(x, -1) < 0 AND atan2(lo, -1) < 0 THEN '-0'::double precision ELSE 0 END ELSE greatest(x, lo) END AS _tsql_1) AS t);
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
  RETURN COALESCE(NULLIF(position('1' IN x::bit(32)), 0) - 1, 32);
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
  RETURN CASE WHEN x = 'NaN'::double precision OR x = 0 OR abs(x) = 'Infinity'::double precision THEN x ELSE CASE WHEN abs(x) >= 3.4028235677973366e+38::double precision THEN sign(x) * 'Infinity'::double precision ELSE CASE WHEN abs(x) <= 7.006492321624085e-46::double precision THEN sign(x) * 0 ELSE x::real::double precision END END END;
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
  RETURN (((a::bigint * b::bigint + 2147483648) % 4294967296 + 4294967296) % 4294967296 - 2147483648)::integer;
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
  RETURN CASE WHEN a = 0 AND b = 0 THEN CASE WHEN atan2(a, -1) < 0 AND atan2(b, -1) < 0 THEN '-0'::double precision ELSE 0 END ELSE greatest(a, b) END;
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
  RETURN (SELECT CASE WHEN _tsql_2 = 0 AND c = 0 THEN CASE WHEN atan2(_tsql_2, -1) < 0 AND atan2(c, -1) < 0 THEN '-0'::double precision ELSE 0 END ELSE greatest(_tsql_2, c) END FROM (SELECT (SELECT CASE WHEN a = 0 AND _tsql_1 = 0 THEN CASE WHEN atan2(a, -1) < 0 AND atan2(_tsql_1, -1) < 0 THEN '-0'::double precision ELSE 0 END ELSE greatest(a, _tsql_1) END FROM (SELECT abs(b) AS _tsql_1) AS t) AS _tsql_2) AS t);
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
  RETURN CASE WHEN a = 0 AND b = 0 THEN CASE WHEN atan2(a, -1) < 0 OR atan2(b, -1) < 0 THEN '-0'::double precision ELSE 0 END ELSE -greatest(-a, -b) END;
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
  RETURN (SELECT CASE WHEN _tsql_1 = 0 AND 10 = 0 THEN CASE WHEN atan2(_tsql_1, -1) < 0 OR atan2(10, -1) < 0 THEN '-0'::double precision ELSE 0 END ELSE -greatest(-_tsql_1, -10) END FROM (SELECT CASE WHEN a::double precision = 0 AND b = 0 THEN CASE WHEN atan2(a::double precision, -1) < 0 OR atan2(b, -1) < 0 THEN '-0'::double precision ELSE 0 END ELSE -greatest(-a::double precision, -b) END AS _tsql_1) AS t);
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
  RETURN (SELECT CASE WHEN _tsql_2 = 0 AND c = 0 THEN CASE WHEN atan2(_tsql_2, -1) < 0 OR atan2(c, -1) < 0 THEN '-0'::double precision ELSE 0 END ELSE -greatest(-_tsql_2, -c) END FROM (SELECT (SELECT CASE WHEN a = 0 AND _tsql_1 = 0 THEN CASE WHEN atan2(a, -1) < 0 OR atan2(_tsql_1, -1) < 0 THEN '-0'::double precision ELSE 0 END ELSE -greatest(-a, -_tsql_1) END FROM (SELECT abs(b) AS _tsql_1) AS t) AS _tsql_2) AS t);
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
  RETURN CASE WHEN x - floor(x) >= 0.5::double precision THEN CASE WHEN floor(x) + 1 = 0 AND x < 0 THEN '-0'::double precision ELSE floor(x) + 1 END ELSE floor(x) END;
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
  RETURN (SELECT CASE WHEN _tsql_1 - floor(_tsql_1) >= 0.5::double precision THEN CASE WHEN floor(_tsql_1) + 1 = 0 AND _tsql_1 < 0 THEN '-0'::double precision ELSE floor(_tsql_1) + 1 END ELSE floor(_tsql_1) END FROM (SELECT abs(a) AS _tsql_1) AS t);
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
  RETURN CASE WHEN x = 0 OR x = 'NaN'::double precision THEN x ELSE sign(x) END;
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
  RETURN CASE WHEN x < 0 THEN 'NaN'::double precision ELSE sqrt(x) END;
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
  RETURN (SELECT CASE WHEN _tsql_1 = 0 AND 0 = 0 THEN CASE WHEN atan2(_tsql_1, -1) < 0 AND atan2(0, -1) < 0 THEN '-0'::double precision ELSE 0 END ELSE greatest(_tsql_1, 0) END FROM (SELECT CASE WHEN a::double precision = 0 AND b = 0 THEN CASE WHEN atan2(a::double precision, -1) < 0 AND atan2(b, -1) < 0 THEN '-0'::double precision ELSE 0 END ELSE greatest(a::double precision, b) END AS _tsql_1) AS t);
END;
$$;
