/**
 * Rejected: array methods other than `includes`.
 *
 * `some`, `map`, `filter`, `reduce` and the rest take a callback, and a
 * PL/pgSQL function has no closures to pass. The same rule is a loop:
 *
 *     for (const amount of amounts) { if (amount > 100) { return true; } }
 *
 * Expected: `.some()` is not supported
 * Expected: Write the loop out
 */
export function hasLargeAmount(amounts: readonly number[]): boolean {
  return amounts.some((amount) => amount > 100); // ← rejected here
}
