/**
 * Rejected: `...rest` in a destructuring.
 *
 * The rest would be a new object with the remaining fields — an anonymous shape
 * with no named composite type to become. Read the fields you need by name.
 *
 * Expected: `...rest` in a destructuring is not supported
 */
type Account = { plan: string; seats: number; note: string };

export function planOf(account: Account): string {
  const { note, ...rest } = account;
  return note === "" ? rest.plan : note;
}
