interface Plan {
  name: string;
}

export function samePlan(a: Plan, b: Plan): boolean {
  return a === b;
}
