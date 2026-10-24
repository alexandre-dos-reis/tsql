/**
 * Rejected: `var`.
 *
 * A `var` is function-scoped and hoisted: it exists, as `undefined`, before
 * the line that declares it, and leaks out of the block it is written in. SQL
 * has no `undefined` and no hoisting. Use `const`, or `let` for a value that
 * changes.
 *
 * Expected: `var` is not supported
 */
export function countUp(start: number): number {
  var total = start;
  return total + 1;
}
