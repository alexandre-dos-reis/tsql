import type { Integer } from "../../src/pgtypes";

/**
 * An array field is one column of array type, beside the flattened ones: `Basket` is
 * `(customer_tier text, lines app.basket_line[], tags text[])`, and `app.basket_line` is created
 * first because the column needs it. The field reads as an array anywhere — `for … of`, `.length`,
 * `.includes`, passed on to another rule, held in a local or destructured — and a spread carries it
 * into a new value. Products are reduced with `%` to stay inside int32.
 */

export interface BasketLine {
  readonly sku: string;
  readonly quantity: Integer;
  readonly unitCents: Integer;
}

type Tag = "gift" | "fragile" | "express";

export interface Basket {
  readonly customer: { readonly tier: "standard" | "gold" };
  readonly lines: readonly BasketLine[];
  readonly tags: readonly Tag[];
}

export function linesTotalCents(lines: readonly BasketLine[]): Integer {
  let total = 0;
  for (const line of lines) {
    total += (line.quantity % 100) * (line.unitCents % 1000);
  }
  return total;
}

export function basketTotalCents(basket: Basket): Integer {
  return linesTotalCents(basket.lines);
}

export function isGift(basket: Basket): boolean {
  return basket.tags.includes("gift");
}

export function lineCount(basket: Basket): Integer {
  const { lines } = basket;
  return lines.length;
}

export function biggestLine(basket: Basket): Integer {
  const lines = basket.lines;
  let biggest = 0;
  for (const line of lines) {
    if (line.quantity > biggest) {
      biggest = line.quantity;
    }
  }
  return biggest;
}

export function upgradedBasket(basket: Basket): Basket {
  return { ...basket, customer: { tier: "gold" } };
}
