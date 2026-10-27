import type { Float } from "../../src/index";

/** The constants of `Math` are the doubles themselves, written as literals. */

export function mathPi(): Float {
  return Math.PI;
}

export function mathE(): Float {
  return Math.E;
}

export function mathLn2(): Float {
  return Math.LN2;
}

export function mathLn10(): Float {
  return Math.LN10;
}

export function mathLog2e(): Float {
  return Math.LOG2E;
}

export function mathLog10e(): Float {
  return Math.LOG10E;
}

export function mathSqrt2(): Float {
  return Math.SQRT2;
}

export function mathSqrt1Over2(): Float {
  return Math.SQRT1_2;
}

// Used in arithmetic, a constant is a double like any other.
export function mathArea(r: Float): Float {
  return Math.min(Math.abs(r), Math.PI);
}
