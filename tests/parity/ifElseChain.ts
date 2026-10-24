import type { Integer } from "../../src/pgtypes";

/** `if` / `else if` / fallback `return`, over a string-literal union. */
export type Plan = "free" | "pro" | "enterprise";

export function todoLimit(plan: Plan): Integer {
  if (plan === "free") {
    return 3;
  } else if (plan === "pro") {
    return 100;
  }
  return 1000;
}
