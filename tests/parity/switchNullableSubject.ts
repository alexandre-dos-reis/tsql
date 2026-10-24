/** A nullable discriminant still uses the simple form: NULL matches no WHEN and reaches the ELSE. */
export function greeting(name: string | null): string {
  switch (name) {
    case "bob":
      return "hi bob";
    default:
      return "hi";
  }
}
