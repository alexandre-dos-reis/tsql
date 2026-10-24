/**
 * Rejected: `do … while`.
 *
 * Its body runs before the first test, and a `continue` inside it jumps to the
 * test rather than to the top. Both can be expressed, but a `while` loop says
 * the same thing with one construct the compiler already translates one to one.
 *
 * Expected: `do … while` is not supported
 */
export function atLeastOnce(n: number): number {
  let count = 0;
  do {
    count += 1;
  } while (count < n);
  return count;
}
