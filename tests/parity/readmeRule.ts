import type { Integer } from "../../src/pgtypes";

/**
 * The rule the README opens with: scalar parameters, `Integer`, `||` and `<`.
 *
 * Expected SQL: plan text,
 * Expected SQL: count integer
 * Expected SQL: RETURNS boolean
 * Expected SQL: RETURN plan <> 'free' OR count < 3;
 */
export function canCreateTodo(plan: string, count: Integer): boolean {
  return plan !== "free" || count < 3;
}
