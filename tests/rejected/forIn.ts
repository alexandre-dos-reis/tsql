/**
 * Rejected: `for … in`.
 *
 * It iterates an object's keys at runtime. A composite's columns are fixed by
 * its type, and PL/pgSQL has no loop over them; read the fields by name.
 *
 * Expected: `for … in` is not supported
 */
interface Totals {
  readonly net: number;
  readonly tax: number;
}

export function fieldCount(totals: Totals): number {
  let count = 0;
  for (const key in totals) { // ← rejected here
    if (key !== "") {
      count += 1;
    }
  }
  return count;
}
