export function limitOf(plan: string): number {
  const policy = { plan: plan, limit: 3 };
  return policy.limit;
}
