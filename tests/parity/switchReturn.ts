import type { Integer } from "../../src/pgtypes";

/**
 * A `switch` whose branches only return becomes RETURN CASE … END. SQL's CASE expression takes one
 * value per WHEN, so grouped labels repeat the result.
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

/** The SQL this case must compile to: each block appears, in this order, as written. */
export const sqlExpected = `
--   tier: one of 'enterprise', 'free', 'pro', 'starter' (not enforced here)
CREATE OR REPLACE FUNCTION app.seat_limit(
  tier text
)
RETURNS integer
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  RETURN CASE tier
    WHEN 'free' THEN 1
    WHEN 'starter' THEN 1
    WHEN 'pro' THEN 10
    ELSE 100
  END;
END;
$$;
`;
