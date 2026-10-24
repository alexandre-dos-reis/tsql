/**
 * A nullable discriminant keeps the simple CASE form: NULL matches no WHEN and reaches the ELSE, as
 * `null === "bob"` is false.
 *
 * Expected SQL: RETURN CASE name
 * Expected SQL: WHEN 'bob' THEN 'hi bob'
 * Expected SQL: ELSE 'hi'
 * Expected SQL: END;
 */
export function greeting(name: string | null): string {
  switch (name) {
    case "bob":
      return "hi bob";
    default:
      return "hi";
  }
}
