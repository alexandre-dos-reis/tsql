export interface Seat {
  plan: "free" | "pro";
  count: number;
}

/** Returns a composite, built from a spread of the argument. */
export function grantSeat(seat: Seat): Seat {
  return { ...seat, count: seat.count + 1 };
}

export function seatCount(seat: Seat): number {
  return grantSeat(seat).count;
}
