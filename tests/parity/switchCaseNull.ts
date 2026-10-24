/**
 * `case null` needs the searched CASE form, `WHEN code IS NULL`, with nullable equality for the other
 * labels.
 *
 * Expected SQL: RETURN CASE
 * Expected SQL: WHEN code IS NULL THEN 'none'
 * Expected SQL: WHEN code IS NOT DISTINCT FROM 'a' THEN 'alpha'
 * Expected SQL: ELSE 'other'
 * Expected SQL: END;
 */
export function label(code: string | null): string {
  switch (code) {
    case null:
      return "none";
    case "a":
      return "alpha";
    default:
      return "other";
  }
}
