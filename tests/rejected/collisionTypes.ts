/**
 * Rejected: two object types that map to the same SQL name.
 *
 * `PlanInfo` and `Plan_Info` both become `plan_info` in snake_case, so both would
 * be `CREATE TYPE app.plan_info` — the second would collide with the first (or,
 * worse, silently reuse it). Rename one of them.
 *
 * Expected: already used by `PlanInfo`
 */
type PlanInfo = { name: string };
type Plan_Info = { label: string };

export function nameOf(info: PlanInfo): boolean {
  return info.name === "free";
}

export function labelOf(info: Plan_Info): boolean {
  return info.label === "free";
}
