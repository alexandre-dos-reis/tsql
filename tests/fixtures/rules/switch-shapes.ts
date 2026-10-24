import type { Integer } from "../../../src/pgtypes";

/**
 * One rule per shape a `switch` can compile to, so each is checked against the
 * TypeScript by the parity tests rather than only by reading the SQL.
 */

export type Region = "eu" | "us" | "apac";

/** The CASE statement: branches that compute before they return, with grouped labels. */
export function shippingCents(region: Region, weightGrams: Integer): Integer {
  switch (region) {
    case "eu":
    case "us": {
      const base: Integer = 500;
      return base + weightGrams * 2;
    }
    case "apac":
      if (weightGrams > 1000) {
        return 4000;
      }
      return 2500;
    default:
      return 9999;
  }
}

/** The searched form: `case null` becomes `WHEN code IS NULL`. */
export function couponLabel(code: string | null): string {
  switch (code) {
    case null:
      return "no coupon";
    case "WELCOME":
      return "welcome offer";
    default:
      return "other coupon";
  }
}

/** A nullable discriminant in the simple form: NULL matches no WHEN and reaches the default. */
export function salutation(name: string | null): string {
  switch (name) {
    case "":
      return "anonymous";
    default:
      return "hello";
  }
}

/** `break`, an empty `default`, and a computed discriminant, with code after the `switch`. */
export function bonusPoints(spentCents: Integer): Integer {
  switch (spentCents % 3) {
    case 0:
      return 30;
    default:
      break;
  }
  return 10;
}
