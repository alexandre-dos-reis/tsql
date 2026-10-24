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
