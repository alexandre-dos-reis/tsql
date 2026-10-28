CREATE OR REPLACE FUNCTION app.read_decimal(
  text text
)
RETURNS integer
LANGUAGE sql
IMMUTABLE
RETURN tsql.number_parse_int_10(text);

CREATE OR REPLACE FUNCTION app.read_number(
  text text
)
RETURNS integer
LANGUAGE sql
IMMUTABLE
RETURN tsql.number_parse_int(text);

RETURN tsql.number_parse_int_10(a) + tsql.number_parse_int_10(b);
