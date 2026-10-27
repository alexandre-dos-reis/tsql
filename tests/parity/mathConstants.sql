-- The SQL this case must compile to: each block below (blocks are separated by a
-- blank line) must appear in the compiler's output, in order, as consecutive lines,
-- indentation aside. Only the types and functions are listed, without the type
-- guard's boilerplate or the provenance comments, so this file is not runnable on its own.

CREATE OR REPLACE FUNCTION app.math_area(
  r double precision
)
RETURNS double precision
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  RETURN (SELECT CASE WHEN _tsql_1 = 0 AND 3.141592653589793::double precision = 0 THEN CASE WHEN atan2(_tsql_1, -1) < 0 OR atan2(3.141592653589793::double precision, -1) < 0 THEN '-0'::double precision ELSE 0 END ELSE -greatest(-_tsql_1, -3.141592653589793::double precision) END FROM (SELECT abs(r) AS _tsql_1) AS t);
END;
$$;

CREATE OR REPLACE FUNCTION app.math_e(

)
RETURNS double precision
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  RETURN 2.718281828459045::double precision;
END;
$$;

CREATE OR REPLACE FUNCTION app.math_ln10(

)
RETURNS double precision
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  RETURN 2.302585092994046::double precision;
END;
$$;

CREATE OR REPLACE FUNCTION app.math_ln2(

)
RETURNS double precision
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  RETURN 0.6931471805599453::double precision;
END;
$$;

CREATE OR REPLACE FUNCTION app.math_log10e(

)
RETURNS double precision
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  RETURN 0.4342944819032518::double precision;
END;
$$;

CREATE OR REPLACE FUNCTION app.math_log2e(

)
RETURNS double precision
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  RETURN 1.4426950408889634::double precision;
END;
$$;

CREATE OR REPLACE FUNCTION app.math_pi(

)
RETURNS double precision
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  RETURN 3.141592653589793::double precision;
END;
$$;

CREATE OR REPLACE FUNCTION app.math_sqrt1_over2(

)
RETURNS double precision
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  RETURN 0.7071067811865476::double precision;
END;
$$;

CREATE OR REPLACE FUNCTION app.math_sqrt2(

)
RETURNS double precision
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  RETURN 1.4142135623730951::double precision;
END;
$$;
