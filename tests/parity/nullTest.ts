/**
 * `x !== null` becomes `IS NOT NULL`, combined with boolean operators.
 */
export type Plan = "free" | "pro" | "enterprise";

export function isEligibleForTrial(plan: Plan, hadTrial: boolean, referral: string | null): boolean {
  return plan === "free" && !hadTrial && referral !== null;
}

/** The SQL this case must compile to: each block appears, in this order, as written. */
export const sqlExpected = `
--   plan: one of 'enterprise', 'free', 'pro' (not enforced here)
CREATE OR REPLACE FUNCTION app.is_eligible_for_trial(
  plan text,
  had_trial boolean,
  referral text
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  RETURN plan = 'free' AND NOT had_trial AND referral IS NOT NULL;
END;
$$;
`;
