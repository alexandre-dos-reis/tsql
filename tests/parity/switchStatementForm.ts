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

/** The SQL this case must compile to: each block appears, in this order, as written. */
export const sqlExpected = `
--   tier: one of 'enterprise', 'free', 'pro', 'starter' (not enforced here)
CREATE OR REPLACE FUNCTION app.discounted(
  tier text,
  amount integer
)
RETURNS integer
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  off integer;
BEGIN
  CASE tier
    WHEN 'free', 'starter' THEN
      off := 5;
      RETURN amount - off;
    ELSE
      RETURN amount;
  END CASE;
END;
$$;

--   region: one of 'apac', 'eu', 'us' (not enforced here)
CREATE OR REPLACE FUNCTION app.shipping_cents(
  region text,
  weight_grams integer
)
RETURNS integer
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  base integer;
BEGIN
  CASE region
    WHEN 'eu', 'us' THEN
      base := 500;
      RETURN base + weight_grams * 2;
    WHEN 'apac' THEN
      IF weight_grams > 1000 THEN
        RETURN 4000;
      END IF;
      RETURN 2500;
    ELSE
      RETURN 9999;
  END CASE;
END;
$$;
`;
