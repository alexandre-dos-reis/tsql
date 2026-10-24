/**
 * A nullable discriminant keeps the simple CASE form: NULL matches no WHEN and reaches the ELSE, as
 * `null === "bob"` is false.
 */
export function greeting(name: string | null): string {
  switch (name) {
    case "bob":
      return "hi bob";
    default:
      return "hi";
  }
}
