/**
 * Rejected: calling a method on a value.
 *
 * `plan.toUpperCase()` is a JavaScript string method. `upper(plan)` is not the
 * same function — it follows the database's locale and collation rules, not
 * JavaScript's Unicode case mapping — so methods on values are outside the
 * subset.
 *
 * Expected: methods on values are not part of the compiled subset
 */
export function isFreePlan(plan: string): boolean {
  return plan.toUpperCase() === "FREE";
}
