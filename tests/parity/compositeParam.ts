import type { Integer } from "../../src/index";

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
