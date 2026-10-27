import { int, type Integer } from "../../src/index";

/**
 * An array field is one column of array type, beside the others: `Basket` is
 * `(customer app.basket_customer, lines app.basket_line[], tags app.tag[])`, and both composites are
 * created first because the columns need them. The field reads as an array anywhere — `for … of`, `.length`,
 * `.includes`, passed on to another function, held in a local or destructured — and a spread carries it
 * into a new value. Products are reduced with `%` to stay inside int32.
 */

export interface BasketLine {
  readonly sku: string;
  readonly quantity: Integer;
  readonly unitCents: Integer;
}

type Tag = "gift" | "fragile" | "express";

export interface BasketCustomer {
  readonly tier: "standard" | "gold";
}

export interface Basket {
  readonly customer: BasketCustomer;
  readonly lines: readonly BasketLine[];
  readonly tags: readonly Tag[];
}

export function linesTotalCents(lines: readonly BasketLine[]): Integer {
  let total = 0;
  for (const line of lines) {
    total = int(total + int((line.quantity % 100) * (line.unitCents % 1000)));
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
