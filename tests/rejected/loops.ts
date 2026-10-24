/**
 * Rejected: loops (`while`, `for`, …).
 *
 * The compiled subset has no iteration: a business rule here is a decision over
 * its inputs, and modelling loops faithfully (mutation, termination) is out of
 * scope. Express the rule without iteration.
 */
export function spin(n: number): number {
  while (n > 0) {
    return n;
  }
  return 0;
}
