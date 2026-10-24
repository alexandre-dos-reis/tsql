/**
 * Rejected: a default value in a destructuring (`{ note = "" }`).
 *
 * A default applies when the property is `undefined`. SQL has no `undefined` —
 * the field is either a value or NULL, and a default does not apply on `null` in
 * TypeScript either — so there is no faithful translation. Make the field
 * `string | null` and use `??` explicitly.
 *
 * Expected: Default values in a destructuring are not supported
 */
type Account = { plan: string; note: string };

export function noteOf(account: Account): string {
  const { note = "none" } = account;
  return note;
}
