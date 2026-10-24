/**
 * Returning a composite built from a spread of the argument, and reading a field off a call that
 * returns one.
 */
export interface Seat {
  plan: "free" | "pro";
  count: number;
}

export function grantSeat(seat: Seat): Seat {
  return { ...seat, count: seat.count + 1 };
}

export function seatCount(seat: Seat): number {
  return grantSeat(seat).count;
}

/** The SQL this case must compile to: each block appears, in this order, as written. */
export const sqlExpected = `
IF to_regtype('app.seat') IS NULL THEN
  CREATE TYPE app.seat AS (
    plan text,
    count double precision
  );

CREATE OR REPLACE FUNCTION app.grant_seat(
  seat app.seat
)
RETURNS app.seat
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  RETURN ROW((seat).plan, (seat).count + 1)::app.seat;
END;
$$;

CREATE OR REPLACE FUNCTION app.seat_count(
  seat app.seat
)
RETURNS double precision
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  RETURN (app.grant_seat(seat)).count;
END;
$$;
`;
