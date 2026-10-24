export type Plan = "free" | "pro";

export function limit(plan: Plan): number {
  switch (plan) {
    case "free":
      return 3;
    case "pro":
      return 100;
  }
}
