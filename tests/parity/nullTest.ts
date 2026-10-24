/**
 * `x !== null` becomes `IS NOT NULL`, combined with boolean operators.
 */
export type Plan = "free" | "pro" | "enterprise";

export function isEligibleForTrial(plan: Plan, hadTrial: boolean, referral: string | null): boolean {
  return plan === "free" && !hadTrial && referral !== null;
}
