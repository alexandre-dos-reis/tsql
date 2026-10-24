/**
 * Rejected: an assignment used as a value (`return (n = n + 1)`).
 *
 * An assignment is a statement in PL/pgSQL (`n := n + 1;`), not an expression
 * with a value. Write it on its own line, then use the variable.
 *
 * Expected: An assignment is only supported as a statement of its own
 */
export function next(start: number): number {
  let n = start;
  return (n = n + 1);
}
