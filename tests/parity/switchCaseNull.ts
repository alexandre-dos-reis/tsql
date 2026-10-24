/** `case null` needs the searched form. */
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
