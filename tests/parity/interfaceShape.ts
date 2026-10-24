/**
 * An `interface` maps to a composite type the same way a type alias does, and its CREATE TYPE is
 * guarded.
 *
 * Expected SQL: IF to_regtype('app.todo_policy') IS NULL THEN
 * Expected SQL: CREATE TYPE app.todo_policy AS (
 * Expected SQL: plan text,
 * Expected SQL: current_count double precision
 * Expected SQL: RAISE EXCEPTION
 * Expected SQL: policy app.todo_policy
 */
export interface TodoPolicy {
  plan: "free" | "pro";
  currentCount: number;
}

export function canAddTodo(policy: TodoPolicy): boolean {
  return policy.plan !== "free" || policy.currentCount < 3;
}
