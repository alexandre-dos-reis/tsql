import type { Float, Integer } from "../src/pgtypes";

/** Pricing rules: where null handling and number types matter. */

/** Null means null: `??` becomes `COALESCE`, and an absent discount stays distinct from a zero one. */
export function priceCents(listCents: Integer, percentOff: Float | null): Float {
  const discount = percentOff ?? 0;
  return (listCents * (100 - discount)) / 100;
}

/** Nullable comparisons are handled for you: `!==` on a nullable value becomes `IS DISTINCT FROM`. */
export function isNotEmpty(couponCode: string | null): boolean {
  if (couponCode === null) {
    return false;
  }
  return couponCode !== "";
}
