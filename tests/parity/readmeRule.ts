import type { Integer } from "../../src/pgtypes";

/**
 * The rule the README opens with: scalar parameters, `Integer`, `||` and `<`.
 */
export function canCreateTodo(plan: string, count: Integer): boolean {
  return plan !== "free" || count < 3;
}

/** The SQL this case must compile to: each block appears, in this order, as written. */
export const sqlExpected = `
CREATE OR REPLACE FUNCTION app.can_create_todo(
  plan text,
  count integer
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  RETURN plan <> 'free' OR count < 3;
END;
$$;
`;
