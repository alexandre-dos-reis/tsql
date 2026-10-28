/**
 * Rejected: `Number.parseInt` without `int(...)` around it.
 *
 * It answers `NaN` for text it cannot read, and is not bounded by 32 bits, so
 * its result is not an `Integer` until something has said what happens to those
 * two cases. `int` is that something: it raises on both in TypeScript, and the
 * cast it becomes raises on both in PostgreSQL, so the two sides agree — by
 * both raising, which the parity harness counts as agreement.
 *
 * Expected: must sit directly inside `int(...)`
 * Expected: int(Number.parseInt(text, 10))
 */
export function cents(text: string): number {
  return Number.parseInt(text, 10); // ← rejected here
}
