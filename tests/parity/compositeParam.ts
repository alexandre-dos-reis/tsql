import type { Integer } from "../../src/pgtypes";

/**
 * A named object type as a parameter: a composite type, read with `(sub).plan`, created before the
 * function.
 */
type Subscription = {
  plan: "free" | "pro" | "max";
};

export function canCreateTodoWithType(sub: Subscription, count: Integer): boolean {
  const plan = sub.plan;

  if (plan === "free") {
    return count <= 3;
  }
  if (plan === "pro") {
    return count <= 6;
  }
  return count <= 9;
}

/** The SQL this case must compile to: each block appears, in this order, as written. */
export const sqlExpected = `
IF to_regtype('app.subscription') IS NULL THEN
  CREATE TYPE app.subscription AS (
    plan text
  );

CREATE OR REPLACE FUNCTION app.can_create_todo_with_type(
  sub app.subscription,
  count integer
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  plan text;
BEGIN
  plan := (sub).plan;
  IF plan = 'free' THEN
    RETURN count <= 3;
  END IF;
  IF plan = 'pro' THEN
    RETURN count <= 6;
  END IF;
  RETURN count <= 9;
END;
$$;
`;
