import type { Integer } from "@adr/tsql/pgtypes";

export type Plan = "free" | "pro";

export function seatPrice(plan: Plan, seats: Integer): Integer {
  if (plan === "free") {
    return 0;
  }
  return seats * 12;
}
