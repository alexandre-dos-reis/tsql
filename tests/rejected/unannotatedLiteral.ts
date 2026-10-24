/**
 * Rejected: an object literal without a target type.
 *
 * An object literal compiles to `ROW(...)::app.<type>`, and the cast needs a named
 * type to aim at. `{ plan, limit: 3 }` has none. Annotate it
 * (`const policy: Policy = { ... }`) or return it from a function with a named
 * return type.
 */
export function limitOf(plan: string): number {
  const policy = { plan: plan, limit: 3 };
  return policy.limit;
}
