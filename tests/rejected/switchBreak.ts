/**
 * Rejected: `break` anywhere but at the end of a `switch` clause.
 *
 * A `switch` compiles to a `CASE`; a `break` inside a nested `if` would jump out
 * of the `CASE` half-way through a branch, control flow a `CASE` branch does not
 * model. End the clause with `break` or `return`, and nowhere else.
 */
export function score(grade: string, bonus: boolean): number {
  switch (grade) {
    case "a":
      if (bonus) {
        break;
      }
      return 5;
    default:
      return 1;
  }
  return 0;
}
