/**
 * Rejected: a fraction assigned to a `let` that holds an integer.
 *
 * Without an annotation, a `let` takes the type of its initial value: `0` is an
 * integer, so `total` is an `integer` variable. TypeScript widens it to
 * `number` and happily keeps 0.5; PostgreSQL would round on assignment:
 *
 *     total := total + 0.5::double precision;  -- total is integer: 0.5 becomes 0 or 1
 *
 * Declare the variable wider: `let total: number = 0`.
 *
 * Expected: which PostgreSQL would round silently. Declare the variable wider
 */
export function halfSteps(steps: number): number {
  let total = 0;
  total += 0.5;
  return total + steps;
}
