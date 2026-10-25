/**
 * Returning a composite unchanged: PL/pgSQL passes it straight back.
 */
interface PlanRecord {
  name: string;
  seats: number;
}

export function echoPlan(plan: PlanRecord): PlanRecord {
  return plan;
}
