import type { Integer } from "../../src/pgtypes";

/**
 * A computed discriminant is evaluated once, by the CASE itself; an empty `default` becomes `ELSE
 * NULL;`.
 *
 * Expected SQL: CASE n % 3
 * Expected SQL: WHEN 0 THEN
 * Expected SQL: RETURN 'fizz';
 * Expected SQL: ELSE
 * Expected SQL: NULL;
 * Expected SQL: END CASE;
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
