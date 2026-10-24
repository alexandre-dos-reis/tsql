/**
 * An `interface` maps to a composite type the same way a type alias does, and its CREATE TYPE is
 * guarded.
 */
export interface TodoPolicy {
  plan: "free" | "pro";
  currentCount: number;
}

export function canAddTodo(policy: TodoPolicy): boolean {
  return policy.plan !== "free" || policy.currentCount < 3;
}
