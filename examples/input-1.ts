import type { Float, Integer } from "../src/pgtypes";

export type Plan = "free" | "pro" | "enterprise";

export function todoLimit(plan: Plan): Integer {
  if (plan === "free") {
    return 3;
  } else if (plan === "pro") {
    return 100;
  }
  return 1000;
}

/** Calls another compiled function, and holds an intermediate in a local. */
export function remainingTodos(plan: Plan, count: Integer): Integer {
  const limit = todoLimit(plan);
  if (count >= limit) {
    return 0;
  }
  return limit - count;
}

/** Explicit null semantics: an absent discount is not a zero discount. */
export function priceCents(listCents: Integer, percentOff: Float | null): Float {
  const discount = percentOff ?? 0;
  return (listCents * (100 - discount)) / 100;
}

export function isEligibleForTrial(plan: Plan, hadTrial: boolean, referral: string | null): boolean {
  return plan === "free" && !hadTrial && referral !== null;
}

export function isNotEmpty(string: string | null): boolean {
  if (string === null) {
    return false;
  }
  return string !== "";
}
