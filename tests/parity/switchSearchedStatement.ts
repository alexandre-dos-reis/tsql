/** The searched statement form, for the same reason. */
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
