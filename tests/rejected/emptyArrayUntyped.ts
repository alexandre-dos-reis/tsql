/**
 * Rejected: an empty array with no type to take.
 *
 * `ARRAY[]` has no type in PostgreSQL — `SELECT cardinality(ARRAY[])` is the
 * error "cannot determine type of empty array" — so `[]` needs one from where
 * it stands: an annotation, a return type, a parameter, an object field.
 *
 * Expected: An empty array needs a type
 */
export function nothing(): number {
  return [].length; // ← rejected here
}
