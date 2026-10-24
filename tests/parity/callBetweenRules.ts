import type { Integer } from "../../src/pgtypes";

/** One compiled rule calling another, through a local whose name is a reserved word. */
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
