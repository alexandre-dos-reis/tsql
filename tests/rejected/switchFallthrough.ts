/**
 * Rejected: a `switch` clause that falls through into the next one.
 *
 * When `bonus` is false, clause "a" runs on into clause "b". A `CASE` has no
 * fallthrough — each `WHEN` branch is separate:
 *
 *     CASE grade WHEN 'a' THEN ... WHEN 'b' THEN RETURN 2; ... END CASE;
 *
 * so the SQL would skip clause "b" where TypeScript runs it. End each non-empty
 * clause with `break` or `return` (empty clauses grouping labels are fine).
 *
 * Expected: falls through into the next one
 */
export function score(grade: string, bonus: boolean): number {
  switch (grade) {
    case "a":
      if (bonus) {
        return 5;
      }
    case "b":
      return 2;
    default:
      return 0;
  }
  return 0;
}
