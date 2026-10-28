CREATE OR REPLACE FUNCTION app.read_decimal(
  text text
)
RETURNS integer
LANGUAGE sql
IMMUTABLE
RETURN tsql.number_parse_int(text, 10);

CREATE OR REPLACE FUNCTION app.read_number(
  text text
)
RETURNS integer
LANGUAGE sql
IMMUTABLE
RETURN tsql.number_parse_int(text, 0);

RETURN tsql.number_parse_int(a, 10) + tsql.number_parse_int(b, 10);
