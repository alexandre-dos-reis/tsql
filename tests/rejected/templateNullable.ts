/**
 * Rejected: a nullable value in a template literal.
 *
 * TypeScript writes `null` into the string; SQL's `||` with NULL is NULL:
 *
 *     TS:  `owner: ${null}`       -> "owner: null"
 *     SQL: 'owner: ' || NULL      -> NULL
 *
 * Narrow it first, or give the fallback with `??`.
 *
 * Expected: may be null: a template literal writes "null" in TypeScript
 */
export function ownerLabel(owner: string | null): string {
  return `owner: ${owner}`; // ← rejected here
}
