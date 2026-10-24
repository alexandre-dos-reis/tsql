/**
 * Rejected: `%` on a `number` (double precision).
 *
 * PostgreSQL has no `%` operator for `double precision`, so the generated SQL
 * would fail. If the value is a whole number, type it as `Integer` and `%`
 * compiles to integer modulo.
 *
 * Expected: `%` is not defined for `double precision`
 */
export function isEven(n: number): boolean {
  return n % 2 === 0;
}
