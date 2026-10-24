import type { Integer } from "../../src/pgtypes";

/**
 * The rule the README opens with: scalar parameters, `Integer`, `||` and `<`.
 */
export function canCreateTodo(plan: string, count: Integer): boolean {
  return plan !== "free" || count < 3;
}
