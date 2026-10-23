type PlanInfo = { name: string };
type Plan_Info = { label: string };

export function nameOf(info: PlanInfo): boolean {
  return info.name === "free";
}

export function labelOf(info: Plan_Info): boolean {
  return info.label === "free";
}
