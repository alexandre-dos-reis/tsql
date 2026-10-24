/**
 * Rejected: loose equality `==` / `!=`.
 *
 * JavaScript's `==` coerces types (`"1" == 1`, `null == undefined`); SQL has no
 * equivalent. Use `===` / `!==`, which compile to `=` / `<>` or, for nullable
 * operands, `IS NOT DISTINCT FROM` / `IS DISTINCT FROM`.
 */
export function isFreeLoose(plan: string): boolean {
  return plan == "free";
}
