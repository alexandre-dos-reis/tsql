interface Plan {
  name: string;
  seats: number;
}

/** Returning a composite unchanged: PL/pgSQL passes it straight back. */
export function echoPlan(plan: Plan): Plan {
  return plan;
}
