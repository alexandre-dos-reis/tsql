/**
 * Rejected: a radix that is not a literal.
 *
 * Which helper the call becomes is decided at build time, so the radix has to
 * be readable then. A parameter could be 16 at run time, and the SQL would
 * already have been written for base ten.
 *
 * Expected: written as a literal
 * Not expected: must sit directly inside
 */
export function read(text: string, radix: number): number {
  return Number.parseInt(text, radix); // ← rejected here
}
