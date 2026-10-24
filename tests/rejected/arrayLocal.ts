/**
 * Rejected: an array held in a local.
 *
 * Arrays are read-only parameters for now; a local copy would add nothing but
 * a second name for the same value. Use the parameter directly.
 *
 * Expected: would be an array local
 */
export function itemCount(items: readonly number[]): number {
  const copy = items; // ← rejected here
  return copy.length;
}
