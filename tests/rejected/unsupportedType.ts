/**
 * Rejected: `Date` as a parameter type.
 *
 * `Date` is a built-in JavaScript class, not a plain object shape, so it is not
 * turned into a composite type; and its semantics (millisecond epoch, local time
 * zone) do not match `timestamptz`. Pass a number of milliseconds, or a string.
 */
export function isPast(when: Date): boolean {
  return when.getTime() < 0;
}
