/**
 * Rejected: `Math.sin`, which ECMAScript only requires to be approximate.
 *
 * Each engine rounds the last bits its own way — in the measurements behind
 * `docs/design.md`, V8 and JavaScriptCore disagreed with each other on some
 * inputs for every function of this kind, and both with PostgreSQL's libm — so
 * `sin(x)` on both sides would agree to a few ulps, not to the bit. `Float`
 * promises the same bits.
 *
 * Expected: `Math.sin` is not supported
 * Expected: engines round its last bits differently
 */
export function wave(x: number): number {
  return Math.sin(x); // ← rejected here
}
