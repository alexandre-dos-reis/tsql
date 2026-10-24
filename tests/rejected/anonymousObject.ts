export function hasPlan(sub: { plan: string }): boolean {
  return sub.plan !== "free";
}
