/**
 * Rejected: reading a property of a non-object value (`plan.length`).
 *
 * `length` on a string is JavaScript semantics (UTF-16 code units); SQL's
 * `length(text)` counts characters, so emoji and other astral characters would
 * make the two disagree. Property and element access on values are outside the
 * subset.
 *
 * Expected: object and element access are not part of the compiled subset
 */
export function hasText(plan: string): boolean {
  return plan.length > 0;
}
