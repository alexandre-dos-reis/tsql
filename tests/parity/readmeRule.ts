import type { Integer } from "../../src/pgtypes";

/** The rule the README opens with; its SQL is asserted verbatim in tests/sql.test.ts. */
export function canCreateTodo(plan: string, count: Integer): boolean {
  return plan !== "free" || count < 3;
}
