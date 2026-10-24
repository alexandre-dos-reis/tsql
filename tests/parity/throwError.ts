import type { Integer } from "../../src/pgtypes";

/**
 * `throw new Error(message)` is `RAISE EXCEPTION '%', message`: the message is a parameter of the
 * format, so a `%` in it is written as is. A path that throws needs no `return` after it, and a
 * `switch` whose `default` throws keeps the statement form. Parity counts a raise as agreement when
 * both sides raise the same message.
 */

export function seatPrice(plan: "free" | "pro" | "team", seats: Integer): Integer {
  if (seats < 0) {
    throw new Error("seats cannot be negative");
  }
  switch (plan) {
    case "free":
      return 0;
    case "pro":
      return seats * 10;
    default:
      throw new Error("unknown plan");
  }
}

export function discountRate(percent: Integer): number {
  if (percent > 90) throw new Error("over 90% isn't allowed");
  return percent / 100;
}

export function requireNonEmpty(name: string, reason: string): string {
  if (name === "") {
    throw new Error(reason);
  }
  return name;
}

export function nonZero(amount: Integer): Integer {
  if (amount === 0) {
    throw new Error();
  }
  return amount;
}
