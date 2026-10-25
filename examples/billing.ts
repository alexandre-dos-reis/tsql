import type { Integer } from "../src/pgtypes";

/**
 * Billing: what each plan allows. These are the functions the README walks
 * through, compiled for real — `examples/output.sql` is what tsql emits for them.
 */

/** A string-literal union stays `text` in SQL, with its values recorded beside the function. */
export type Plan = "free" | "pro" | "enterprise";

export function todoLimit(plan: Plan): Integer {
  if (plan === "free") {
    return 3;
  } else if (plan === "pro") {
    return 100;
  }
  return 1000;
}

/** An object type becomes a composite type, and functions can call each other. */
export type Subscription = { plan: Plan };

export function canCreateTodo(sub: Subscription, count: Integer): boolean {
  const limit = todoLimit(sub.plan);
  return count < limit;
}

/** A `switch` becomes a `CASE`. The `default` is required: PostgreSQL does not enforce a union's values. */
export type Tier = "free" | "starter" | "pro" | "enterprise";

export function seatLimit(tier: Tier, extraSeats: Integer): Integer {
  switch (tier) {
    case "free":
    case "starter":
      return 1;
    case "pro":
      return 10 + extraSeats;
    default:
      return 100 + extraSeats * 2;
  }
}
