import type { Integer } from "../../src/pgtypes";

/**
 * A computed discriminant is evaluated once, by the CASE itself; an empty `default` becomes `ELSE
 * NULL;`.
 */
export function bucket(n: Integer): string {
  switch (n % 3) {
    case 0:
      return "fizz";
    default:
      break;
  }
  return "plain";
}
