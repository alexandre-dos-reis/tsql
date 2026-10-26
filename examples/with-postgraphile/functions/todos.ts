import type { Integer } from "@adr/tsql/pgtypes";

export type Plan = "free" | "pro";

export function todoLimit(plan: Plan): Integer {
  return plan === "free" ? 3 : 100;
}

export function canAddTodo(plan: Plan, count: Integer): boolean {
  return count < todoLimit(plan);
}
