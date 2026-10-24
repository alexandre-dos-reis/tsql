/**
 * Returning a composite unchanged: PL/pgSQL passes it straight back.
 */
interface Plan {
  name: string;
  seats: number;
}

export function echoPlan(plan: Plan): Plan {
  return plan;
}
