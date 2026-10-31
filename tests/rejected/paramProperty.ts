/**
 * Rejected: `.length` on a string.
 *
 * TypeScript counts UTF-16 code units; PostgreSQL's `length()` counts
 * characters. They agree on all of the BMP and on nothing above it:
 * `'😀'.length` is 2 where `length('😀')` is 1. The answer names the members a
 * string does have, since the member is the mistake rather than the access.
 *
 * Expected: `.length` on a string is not supported
 * Expected: UTF-16 code units
 * Expected: Supported: .trim(), .trimEnd(), .trimStart()
 */
export function hasText(plan: string): boolean {
  return plan.length > 0; // ← rejected here
}
