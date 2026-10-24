/**
 * A parameter may be named after a global: the check is provenance, not spelling.
 *
 * Expected SQL: math double precision
 * Expected SQL: RETURN math + 1;
 */
export function addOne(Math: number): number {
  return Math + 1;
}
