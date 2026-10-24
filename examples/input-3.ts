import type { Integer } from "../src/pgtypes";

export type Tier = "free" | "starter" | "pro" | "enterprise";

/** `switch` with grouped labels and a `default`, compiled to IF/ELSIF/ELSE. */
export function seatLimit(tier: Tier, extraSeats: Integer): Integer {
  switch (tier) {
    case "free":
    case "starter":
      return 1;
    case "pro":
      return 10 + extraSeats;
    default:
      return 100 + extraSeats * 2;
  }
}
