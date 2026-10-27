/**
 * Rejected: `Math.toString`, which every object has and `Math` does not map.
 *
 * Members are looked up in a closed table with `Object.hasOwn`, so what comes
 * from `Object.prototype` is refused like anything else outside it.
 *
 * Expected: `Math.toString` is not supported
 */
export function label(): string {
  return Math.toString(); // ← rejected here
}
