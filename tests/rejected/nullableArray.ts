/**
 * Rejected: an array that may be null.
 *
 * PL/pgSQL's `FOREACH` raises on a NULL array where an empty one loops zero
 * times, and `cardinality(NULL)` is NULL rather than a number, so a nullable
 * array would need every use guarded. An empty array says "nothing" already.
 *
 * Expected: cannot appear in a union: an array is never null
 */
export function itemCount(items: readonly number[] | null): number { // ← rejected here
  return items === null ? 0 : items.length;
}
