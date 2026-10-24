/**
 * Rejected: a non-boolean loop condition (`while (n)`).
 *
 * Like an `if`, a loop condition is not tested for truthiness: `0`, `""` and
 * `NaN` are falsy in JavaScript, and SQL has no such rule (`WHILE n LOOP` does
 * not type-check for an integer). Compare explicitly: `while (n > 0)`.
 *
 * Expected: A `while` condition must be a boolean
 */
export function countDown(start: number): number {
  let n = start;
  let steps = 0;
  while (n) {
    n -= 1;
    steps += 1;
  }
  return steps;
}
