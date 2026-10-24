import type { Integer } from "../../src/pgtypes";

export type Tier = "free" | "starter" | "pro" | "enterprise";

/** Grouped labels, and a `default` that becomes the ELSE: the simple CASE form. */
export function seatLimit(tier: Tier): Integer {
  switch (tier) {
    case "free":
    case "starter":
      return 1;
    case "pro":
      return 10;
    default:
      return 100;
  }
}
