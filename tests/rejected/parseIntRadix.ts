/**
 * Rejected: a radix other than 10.
 *
 * Only two forms were measured against V8: no radix, which reads a leading
 * `0x` as hexadecimal, and the literal `10`, which does not. `parseInt(s, 16)`
 * would need its own SQL, and the compiler does not emit SQL whose agreement
 * with TypeScript nobody has checked.
 *
 * Expected: accepts the radix `10` written as a literal
 * Expected: has not been measured
 * Not expected: is not supported
 * Not expected: must sit directly inside
 */
export function fromHex(text: string): number {
  return Number.parseInt(text, 16); // ← rejected here
}
