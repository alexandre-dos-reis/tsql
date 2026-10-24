/**
 * Rejected: a `switch` without `default`.
 *
 * TypeScript knows `plan` is "free" or "pro", so this looks exhaustive. PostgreSQL
 * does not: the parameter is `text`, and nothing stops a caller passing 'max'. A
 * `CASE` that matches nothing raises:
 *
 *     CASE plan WHEN 'free' THEN RETURN 3; WHEN 'pro' THEN RETURN 100; END CASE;
 *     -- ERROR: case not found
 *
 * Add a `default` that handles any other value; it becomes the `ELSE`.
 */
export type Plan = "free" | "pro";

export function limit(plan: Plan): number {
  switch (plan) {
    case "free":
      return 3;
    case "pro":
      return 100;
  }
}
