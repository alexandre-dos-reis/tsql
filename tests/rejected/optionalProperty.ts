interface Account {
  plan: string;
  note?: string;
}

export function isFreeAccount(account: Account): boolean {
  return account.plan === "free";
}
