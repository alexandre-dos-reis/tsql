import { int, type Float, type Integer } from "../../src/index";

/**
 * The members of `Math` that are a PostgreSQL function under the same or another
 * name, with nothing rewritten: `abs`, `floor`, `ceil`, `trunc`, `sign`, `sqrt`,
 * `min` and `max`. The harness compares each against its TypeScript on 200
 * generated inputs, so a function PostgreSQL computed differently would fail here.
 */

export function mathAbsFloat(x: Float): Float {
  return Math.abs(x);
}

// `abs(-2147483648)` raises in PostgreSQL only, so an `Integer` needs the guard.
export function mathAbsInt(x: Integer): Integer {
  return int(Math.abs(x));
}

export function mathFloor(x: Float): Float {
  return Math.floor(x);
}

// An `Integer` is widened to a double first: `floor` always answers a `Float`.
export function mathFloorInt(x: Integer): Float {
  return Math.floor(x);
}

export function mathCeil(x: Float): Float {
  return Math.ceil(x);
}

export function mathTrunc(x: Float): Float {
  return Math.trunc(x);
}

export function mathSign(x: Float): Float {
  return Math.sign(x);
}

// `Math.sqrt` of a negative number is NaN, and PostgreSQL raises: guard the input.
export function mathSqrt(x: Float): Float {
  return x >= 0 ? Math.sqrt(x) : 0;
}

export function mathMax(a: Float, b: Float): Float {
  return Math.max(a, b);
}

export function mathMinInt(a: Integer, b: Integer): Integer {
  return Math.min(a, b);
}

export function mathClamp(x: Float, lo: Float, hi: Float): Float {
  return Math.min(Math.max(x, lo), hi);
}

// Several arguments, of different widths: the widest wins and each is widened to it.
export function mathWidest(a: Integer, b: Float): Float {
  return Math.max(a, b, 0);
}
