import type { Integer } from "../src/pgtypes";

/** The readme's example, compiled verbatim. */
export function canCreateTodo(plan: string, count: Integer): boolean {
  return plan !== "free" || count < 3;
}

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

// export function returnSub(): Subscription {
//   return { plan: "free" };
// }

type Nested = {
  foo: { bar: string };
};

export function someNestedTest(nested: Nested): string {
  nested.foo.bar = "some";
  return nested.foo.bar;
}
