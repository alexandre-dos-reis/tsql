/**
 * Rejected: a function without an explicit return type.
 *
 * The signature is part of the contract between TypeScript and SQL — it decides
 * `RETURNS boolean` versus `RETURNS text` — so it has to be written down, not
 * inferred and silently changed by an edit to the body.
 *
 * Expected: Add an explicit return type
 */
export function isFree(plan: string) {
  return plan === "free";
}
