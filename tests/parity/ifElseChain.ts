import type { Integer } from "../../src/pgtypes";

/**
 * `if` / `else if` / fallback `return` over a string-literal union, whose values are recorded beside
 * the function.
 */
export type Plan = "free" | "pro" | "enterprise";

export function todoLimit(plan: Plan): Integer {
  if (plan === "free") {
    return 3;
  } else if (plan === "pro") {
    return 100;
  }
  return 1000;
}

/** The SQL this case must compile to: each block appears, in this order, as written. */
export const sqlExpected = `
--   plan: one of 'enterprise', 'free', 'pro' (not enforced here)
CREATE OR REPLACE FUNCTION app.todo_limit(
  plan text
)
RETURNS integer
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  IF plan = 'free' THEN
    RETURN 3;
  ELSIF plan = 'pro' THEN
    RETURN 100;
  END IF;
  RETURN 1000;
END;
$$;
`;
