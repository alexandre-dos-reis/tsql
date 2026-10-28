-- The SQL this case must compile to: each block below (blocks are separated by a
-- blank line) must appear in the compiler's output, in order, as consecutive lines,
-- indentation aside. Only the types and functions are listed, without the type
-- guard's boilerplate or the provenance comments, so this file is not runnable on its own.

IF to_regtype('app.seat') IS NULL THEN
  CREATE TYPE app.seat AS (
    plan text,
    count double precision
  );

CREATE OR REPLACE FUNCTION app.grant_seat(
  seat app.seat
)
RETURNS app.seat
LANGUAGE sql
IMMUTABLE
RETURN ROW((seat).plan, (seat).count + 1)::app.seat;

CREATE OR REPLACE FUNCTION app.seat_count(
  seat app.seat
)
RETURNS double precision
LANGUAGE sql
IMMUTABLE
RETURN (app.grant_seat(seat)).count;

