/**
 * The searched form as a statement: `case null` with a branch that does more than return.
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
