/**
 * Rejected: throwing a subclass of `Error`.
 *
 * Every `RAISE EXCEPTION` from the generated function has SQLSTATE P0001, so a
 * TypeScript caller that tells a `RangeError` from a `TypeError` could not do
 * the same with the SQL one. Throw a plain `Error` with a message that says it.
 *
 * Expected: `RangeError` is not supported: every exception raised from PL/pgSQL has the same SQLSTATE
 */
export function percent(value: number): number {
  if (value > 100) {
    throw new RangeError("over 100"); // ← rejected here
  }
  return value;
}
