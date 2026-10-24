/**
 * Rejected: logical and exponent assignment (`??=`, `||=`, `&&=`, `**=`).
 *
 * `x ??= y` only assigns when `x` is null — a hidden condition. It is clearer,
 * and translates one to one, written out: `x = x ?? y`.
 *
 * Expected: `??=` is not supported; write the assignment out
 */
export function noteOf(start: string | null): string {
  let note = start;
  note ??= "none";
  return note ?? "";
}
