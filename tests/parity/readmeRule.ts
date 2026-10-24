import type { Integer } from "../../src/pgtypes";

/** The rule the README opens with; readmeRule.sql is the SQL it compiles to. */
export function canCreateTodo(plan: string, count: Integer): boolean {
  return plan !== "free" || count < 3;
}
