/**
 * Returning a composite unchanged: PL/pgSQL passes it straight back.
 *
 * Expected SQL: RETURNS app.plan
 * Expected SQL: RETURN plan;
 */
interface Plan {
  name: string;
  seats: number;
}

export function echoPlan(plan: Plan): Plan {
  return plan;
}
