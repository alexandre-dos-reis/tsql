/**
 * A parameter may be named after a global: the check is provenance, not spelling.
 */
export function addOne(Math: number): number {
  return Math + 1;
}
