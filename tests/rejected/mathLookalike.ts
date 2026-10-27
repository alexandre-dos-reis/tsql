/**
 * Rejected: a project's own `Math`, which is not the global.
 *
 * `Math` is recognised by provenance — a declaration in the standard library —
 * not by its spelling, for the same reason `Integer` and `int` are. A module
 * that declares its own `Math` with a `max` that does something else must not
 * have that call turned into `GREATEST`, so this is a reference to a value
 * declared outside the function.
 *
 * Expected: is a value declared outside the function
 */
const Math = { max: (a: number, b: number): number => (a > b ? a : b) };

export function biggest(a: number, b: number): number {
  return Math.max(a, b); // ← rejected here
}
