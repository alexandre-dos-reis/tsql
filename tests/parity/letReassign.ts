import type { Integer } from "../../src/pgtypes";

/**
 * A `let` local reassigned with `=`, `+=`, `-=`, `*=` and `++`, in branches and after them. A
 * PL/pgSQL variable is overwritten exactly as a TypeScript one. Without an annotation a `let` takes
 * the type of its initial value (`total` is an integer); `p` is annotated `number`.
 */
export function shippingTotal(weight: Integer, express: boolean): Integer {
  let total = 500;
  if (weight > 1000) {
    total += 200;
  }
  if (express) {
    total = total * 2;
  }
  total++;
  return total;
}

export function memberPrice(price: number, member: boolean): number {
  let p: number = price;
  if (member) {
    p -= p / 10;
  }
  return p;
}
