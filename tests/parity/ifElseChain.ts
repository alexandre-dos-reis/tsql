import type { Integer } from "../../src/index";

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
