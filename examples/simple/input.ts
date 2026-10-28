import { int, type Integer } from "@adrdp/tsql";

export type Plan = "free" | "pro";

export function seatPrice(plan: Plan, seats: Integer): Integer {
  if (plan === "free") {
    return 0;
  }
  return int(seats * 12);
}
