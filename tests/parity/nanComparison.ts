import type { Float } from "../../src/index";

// JavaScript: every ordering with a NaN is false, and NaN equals nothing, itself included.
// PostgreSQL: NaN sorts above every number and equals itself. Each comparison is written so that
// the answer is JavaScript's, checking the side that is wrongly true there.
export function nanAbove(x: Float, y: Float): boolean {
  return x > y;
}

export function nanAtLeast(x: Float, y: Float): boolean {
  return x >= y;
}

export function nanBelow(x: Float, y: Float): boolean {
  return x < y;
}

export function nanAtMost(x: Float, y: Float): boolean {
  return x <= y;
}

export function nanEqual(x: Float, y: Float): boolean {
  return x === y;
}

export function nanDiffers(x: Float, y: Float): boolean {
  return x !== y;
}

// The test for NaN that JavaScript has always had.
export function isNotANumber(x: Float): boolean {
  return x !== x;
}

// A literal on the left cannot be NaN, so nothing is added where PostgreSQL is already right.
export function literalAbove(x: Float): boolean {
  return 10 > x;
}
