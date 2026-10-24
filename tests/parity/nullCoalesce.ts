import type { Float, Integer } from "../../src/pgtypes";

/**
 * `??` becomes COALESCE: an absent discount is not a zero discount.
 *
 * Expected SQL: discount := COALESCE(percent_off, 0);
 */
export function priceCents(listCents: Integer, percentOff: Float | null): Float {
  const discount = percentOff ?? 0;
  return (listCents * (100 - discount)) / 100;
}
