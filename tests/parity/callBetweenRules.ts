import type { Integer } from "../../src/pgtypes";

/**
 * One compiled rule calling another — schema-qualified — through a local named after a reserved word,
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

/** The SQL this case must compile to: each block appears, in this order, as written. */
export const sqlExpected = `
--   plan: one of 'enterprise', 'free', 'pro' (not enforced here)
CREATE OR REPLACE FUNCTION app.plan_cap(
  plan text
)
RETURNS integer
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  RETURN CASE WHEN plan = 'free' THEN 3 ELSE 100 END;
END;
$$;

--   plan: one of 'enterprise', 'free', 'pro' (not enforced here)
CREATE OR REPLACE FUNCTION app.remaining_todos(
  plan text,
  count integer
)
RETURNS integer
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  "limit" integer;
BEGIN
  "limit" := app.plan_cap(plan);
  IF count >= "limit" THEN
    RETURN 0;
  END IF;
  RETURN "limit" - count;
END;
$$;
`;
