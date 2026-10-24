import type { Integer } from "../../src/pgtypes";

/**
 * A `switch` whose branches only return becomes RETURN CASE … END. SQL's CASE expression takes one
 * value per WHEN, so grouped labels repeat the result.
 *
 * Expected SQL: RETURN CASE tier
 * Expected SQL: WHEN 'free' THEN 1
 * Expected SQL: WHEN 'starter' THEN 1
 * Expected SQL: WHEN 'pro' THEN 10
 * Expected SQL: ELSE 100
 * Expected SQL: END;
 */
export type Tier = "free" | "starter" | "pro" | "enterprise";

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
