/**
 * Rejected: `let` (and `var`).
 *
 * The compiled subset computes values with `const`; reassignable variables would
 * need mutable state that it does not model. Give each intermediate value its own
 * `const`.
 *
 * Expected: Only `const` declarations are supported
 */
export function countUp(start: number): number {
  let total = start;
  total = total + 1;
  return total;
}
