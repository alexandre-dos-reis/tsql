CREATE OR REPLACE FUNCTION app.read_decimal(
  text text
)
RETURNS double precision
LANGUAGE sql
IMMUTABLE
RETURN tsql.parse_int_10(text);

CREATE OR REPLACE FUNCTION app.read_number(
  text text
)
RETURNS double precision
LANGUAGE sql
IMMUTABLE
RETURN tsql.parse_int(text);

  value := tsql.parse_int_10(text);
