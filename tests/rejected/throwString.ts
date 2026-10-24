/**
 * Rejected: throwing something that is not an `Error`.
 *
 * `RAISE EXCEPTION` says one thing, a message. A thrown string, number or
 * object is caught as itself in TypeScript, and has no faithful SQL form.
 *
 * Expected: Only `throw new Error(message)` is supported
 */
export function check(plan: string): string {
  if (plan === "") {
    throw "empty plan"; // ← rejected here
  }
  return plan;
}
