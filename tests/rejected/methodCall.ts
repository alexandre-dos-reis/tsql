/**
 * Rejected: a method on a string that is not one of the three trims.
 *
 * `plan.toUpperCase()` is JavaScript's Unicode case mapping. `upper(plan)` is
 * not the same function — it follows the database's locale and collation, and
 * neither side maps `ß` to `SS` the way the other does — so it stays outside
 * the subset. The trims are in because `btrim(s, chars)` is handed the exact
 * set of characters to remove, so no locale decides anything.
 *
 * Expected: `.toUpperCase()` on a string is not supported
 * Expected: locale and collation
 * Expected: Supported: .trim(), .trimEnd(), .trimStart()
 */
export function isFreePlan(plan: string): boolean {
  return plan.toUpperCase() === "FREE"; // ← rejected here
}
