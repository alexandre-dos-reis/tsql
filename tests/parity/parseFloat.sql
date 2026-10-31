CREATE OR REPLACE FUNCTION app.read_float(
  text text
)
RETURNS double precision
LANGUAGE sql
IMMUTABLE
RETURN tsql.number_parse_float(text);

CREATE OR REPLACE FUNCTION app.read_half(
  text text
)
RETURNS double precision
LANGUAGE sql
IMMUTABLE
RETURN tsql.number_parse_float(text) / 2;
