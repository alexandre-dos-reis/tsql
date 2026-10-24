/**
 * Rejected: reading an array element by index.
 *
 * Out of range, TypeScript gives `undefined` and PostgreSQL gives NULL; a
 * PostgreSQL array also need not start at 1 (`'[0:1]={a,b}'::text[]`), and a
 * fractional index is rounded where TypeScript reads `undefined`:
 *
 *     SELECT ('{a,b}'::text[])[1.5];  -- 'b'
 *
 * Iterate with `for … of` instead.
 *
 * Expected: is not supported: out of range, TypeScript gives `undefined` where PostgreSQL gives NULL
 */
export function firstAmount(amounts: readonly number[]): number {
  return amounts[0] ?? 0; // ← rejected here
}
