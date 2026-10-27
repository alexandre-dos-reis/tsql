import type { Float, Integer } from "../../src/index";

/**
 * `??` becomes COALESCE: an absent discount is not a zero discount.
 */
export function priceCents(listCents: Integer, percentOff: Float | null): Float {
  const discount = percentOff ?? 0;
  return (listCents * (100 - discount)) / 100;
}
