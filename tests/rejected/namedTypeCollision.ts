/**
 * Rejected: two named sets of strings that map to one SQL type.
 *
 * `UserPlan` and `User_plan` both become `user_plan`. Two types cannot share a
 * name in a schema, and quietly using one for both would check the wrong values.
 *
 * Expected: maps to SQL type `user_plan`, which is already used by `UserPlan`
 */
type UserPlan = "free" | "pro";
type User_plan = "basic" | "premium";

export function sameTier(a: UserPlan, b: User_plan): boolean {
  return a === "free" && b === "basic";
}
