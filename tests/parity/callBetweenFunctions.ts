import type { Integer } from "../../src/pgtypes";

/**
 * One compiled function calling another — schema-qualified — through a local named after a reserved word,
 * which is quoted.
 */
export type Plan = "free" | "pro" | "enterprise";

export function planCap(plan: Plan): Integer {
  return plan === "free" ? 3 : 100;
}

export function remainingTodos(plan: Plan, count: Integer): Integer {
  const limit = planCap(plan);
  if (count >= limit) {
    return 0;
  }
  return limit - count;
}
