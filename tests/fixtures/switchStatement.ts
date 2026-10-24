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

/** A nullable discriminant still uses the simple form: NULL matches no WHEN and reaches the ELSE. */
export function greeting(name: string | null): string {
  switch (name) {
    case "bob":
      return "hi bob";
    default:
      return "hi";
  }
}

/** `case null` needs the searched form. */
export function label(code: string | null): string {
  switch (code) {
    case null:
      return "none";
    case "a":
      return "alpha";
    default:
      return "other";
  }
}

/** A computed discriminant with an empty `default`. */
export function bucket(n: Integer): string {
  switch (n % 3) {
    case 0:
      return "fizz";
    default:
      break;
  }
  return "plain";
}
