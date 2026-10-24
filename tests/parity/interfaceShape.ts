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

/** The SQL this case must compile to: each block appears, in this order, as written. */
export const sqlExpected = `
IF to_regtype('app.todo_policy') IS NULL THEN
  CREATE TYPE app.todo_policy AS (
    plan text,
    current_count double precision
  );

CREATE OR REPLACE FUNCTION app.can_add_todo(
  policy app.todo_policy
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  RETURN (policy).plan <> 'free' OR (policy).current_count < 3;
END;
$$;
`;
