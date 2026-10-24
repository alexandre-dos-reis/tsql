/**
 * `case null` needs the searched CASE form, `WHEN code IS NULL`, with nullable equality for the other
 * labels.
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
