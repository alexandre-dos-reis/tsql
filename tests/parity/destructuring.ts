import type { Integer } from "../../src/pgtypes";

/**
 * `const { a, b } = obj` is one field read per name. A nested pattern reads a field of a nested
 * object, a plain name binds the nested object itself, `{ plan: tier }` renames, and a call result
 * is read once, through a local.
 */
type PurchaseShipping = { country: string; express: boolean };

type Purchase = {
  plan: "free" | "pro";
  quantity: Integer;
  shipping: PurchaseShipping;
};

export function purchaseSummary(purchase: Purchase): Integer {
  const {
    quantity,
    shipping: { express },
  } = purchase;
  return express ? quantity + 1 : quantity;
}

export function shippingCountry(purchase: Purchase): string {
  const { shipping } = purchase;
  return shipping.country;
}

export function purchasePlan(purchase: Purchase): string {
  const { plan: tier } = purchase;
  return tier;
}

export function withBonus(purchase: Purchase): Purchase {
  return { ...purchase, quantity: purchase.quantity + 1 };
}

export function bonusQuantity(purchase: Purchase): Integer {
  const { quantity } = withBonus(purchase);
  return quantity;
}
