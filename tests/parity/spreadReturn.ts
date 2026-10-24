/**
 * Returning a composite built from a spread of the argument, and reading a field off a call that
 * returns one.
 *
 * Expected SQL: RETURNS app.seat
 * Expected SQL: RETURN ROW((seat).plan, (seat).count + 1)::app.seat;
 * Expected SQL: RETURN (app.grant_seat(seat)).count;
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
