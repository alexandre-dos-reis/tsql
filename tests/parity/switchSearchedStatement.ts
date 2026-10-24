/**
 * The searched form as a statement: `case null` with a branch that does more than return.
 *
 * Expected SQL: CASE
 * Expected SQL: WHEN code IS NULL THEN
 * Expected SQL: word := 'none';
 * Expected SQL: RETURN word;
 * Expected SQL: ELSE
 * Expected SQL: RETURN 'some';
 * Expected SQL: END CASE;
 */
export function describeCode(code: string | null): string {
  switch (code) {
    case null: {
      const word = "none";
      return word;
    }
    default:
      return "some";
  }
}
