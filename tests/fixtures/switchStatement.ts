import type { Integer } from "../../src/pgtypes";

export type Tier = "free" | "starter" | "pro" | "enterprise";

/** Grouped labels, `break`, and a `default` that becomes the ELSE. */
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

/** A nullable discriminant matches with IS NOT DISTINCT FROM; `case null` is a null test. */
export function label(code: string | null): string {
  switch (code) {
    case null:
      return "none";
    case "a":
      return "alpha";
  }
  return "other";
}

/** A computed discriminant is evaluated once, into a local. */
export function bucket(n: Integer): string {
  switch (n % 3) {
    case 0:
      return "fizz";
    default:
      break;
  }
  return "plain";
}
