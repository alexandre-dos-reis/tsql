import type { Integer } from "../../src/pgtypes";

/**
 * A branch that does more than return keeps the CASE statement, where grouped labels share one WHEN.
 */
export type Tier = "free" | "starter" | "pro" | "enterprise";

export function discounted(tier: Tier, amount: Integer): Integer {
  switch (tier) {
    case "free":
    case "starter": {
      const off: Integer = 5;
      return amount - off;
    }
    default:
      return amount;
  }
}

export type Region = "eu" | "us" | "apac";

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
