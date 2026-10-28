CREATE OR REPLACE FUNCTION app.read_decimal(
  text text
)
RETURNS integer
LANGUAGE sql
IMMUTABLE
RETURN tsql.number_parse_int_10(text)::integer;

CREATE OR REPLACE FUNCTION app.read_number(
  text text
)
RETURNS integer
LANGUAGE sql
IMMUTABLE
RETURN tsql.number_parse_int(text)::integer;

RETURN tsql.number_parse_int_10(a)::integer + tsql.number_parse_int_10(b)::integer;
