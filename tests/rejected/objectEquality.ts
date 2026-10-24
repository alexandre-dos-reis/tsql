/**
 * Rejected: `===` between two objects.
 *
 * TypeScript compares objects by identity: two distinct objects with the same
 * fields are not `===`. SQL compares composites by value:
 *
 *     SELECT ROW('free')::app.plan = ROW('free')::app.plan;  -- true
 *
 * No faithful translation exists. Compare the fields you care about.
 */
interface Plan {
  name: string;
}

export function samePlan(a: Plan, b: Plan): boolean {
  return a === b;
}
