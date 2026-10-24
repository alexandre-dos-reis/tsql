import type { Integer } from "../../src/pgtypes";

/**
 * `if` / `else if` / fallback `return` over a string-literal union, whose values are recorded beside
 * the function.
 *
 * Expected SQL: --   plan: one of 'enterprise', 'free', 'pro' (not enforced here)
 * Expected SQL: IF plan = 'free' THEN
 * Expected SQL: ELSIF plan = 'pro' THEN
 * Expected SQL: RETURN 1000;
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
