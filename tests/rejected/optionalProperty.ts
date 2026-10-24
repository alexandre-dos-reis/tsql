/**
 * Rejected: an optional property (`note?: string`).
 *
 * A composite column always exists; `undefined` versus "missing" has no SQL
 * equivalent, and SQL models absence one way only. Write `note: string | null`.
 */
interface Account {
  plan: string;
  note?: string;
}

export function isFreeAccount(account: Account): boolean {
  return account.plan === "free";
}
