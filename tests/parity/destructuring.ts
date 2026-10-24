import type { Integer } from "../../src/pgtypes";

/**
 * `const { a, b } = obj` is one field read per name. A nested pattern reads a flattened column,
 * `{ plan: tier }` renames, and a call result is read once, through a local.
 */
type Purchase = {
  plan: "free" | "pro";
  quantity: Integer;
  shipping: { country: string; express: boolean };
};

export function purchaseSummary(purchase: Purchase): Integer {
  const {
    quantity,
    shipping: { express },
  } = purchase;
  return express ? quantity + 1 : quantity;
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
