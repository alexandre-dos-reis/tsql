/**
 * Rejected: `new Error(message, { cause })`.
 *
 * `RAISE` carries a message; there is nowhere to put a cause, and a caller
 * reading `error.cause` in TypeScript would find nothing in SQL.
 *
 * Expected: `Error` options (`{ cause }`) are not supported
 */
export function check(plan: string): string {
  if (plan === "") {
    throw new Error("empty plan", { cause: plan }); // ← rejected here
  }
  return plan;
}
