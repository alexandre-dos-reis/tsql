import type { Integer } from "../../src/pgtypes";

/** A computed discriminant with an empty `default`. */
export function bucket(n: Integer): string {
  switch (n % 3) {
    case 0:
      return "fizz";
    default:
      break;
  }
  return "plain";
}
