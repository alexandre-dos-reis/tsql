import { int, type Float, type Integer } from "../../src/index";

/**
 * The members of `Math` that map: `abs`, `floor`, `ceil`, `trunc`, `sign`, `sqrt`,
 * `min` and `max` — a PostgreSQL function of the same value, except `min` of
 * doubles, `sign` and `sqrt`, written another way to keep a NaN, a zero's sign
 * or a negative root. The harness compares each against its TypeScript on 200
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

// A negative number gives NaN in both: PostgreSQL would raise, so it is answered NaN.
export function mathSqrt(x: Float): Float {
  return Math.sqrt(x);
}

export function mathMax(a: Float, b: Float): Float {
  return Math.max(a, b);
}

export function mathMinInt(a: Integer, b: Integer): Integer {
  return Math.min(a, b);
}

// Doubles: `-greatest(-a, -b)`, so a NaN is returned as `Math.min` does.
export function mathMinFloat(a: Float, b: Float): Float {
  return Math.min(a, b);
}

// A literal is negated at build time; an `Integer` is widened first.
export function mathMinMixed(a: Integer, b: Float): Float {
  return Math.min(a, b, 10);
}

export function mathClamp(x: Float, lo: Float, hi: Float): Float {
  return Math.min(Math.max(x, lo), hi);
}

// Several arguments, of different widths: the widest wins and each is widened to it.
export function mathWidest(a: Integer, b: Float): Float {
  return Math.max(a, b, 0);
}

// Ties go up (PostgreSQL's own `round` sends them to the even neighbour).
export function mathRound(x: Float): Float {
  return Math.round(x);
}

// The argument is not a name: it is computed once, then read several times.
export function mathRoundAbs(a: Float): Float {
  return Math.round(Math.abs(a));
}

// A cast through `real`, with `Infinity` and `0` where PostgreSQL's cast raises.
export function mathFround(x: Float): Float {
  return Math.fround(x);
}

export function mathClz32(x: Integer): Integer {
  return Math.clz32(x);
}

// The product wraps to 32 bits, with no error.
export function mathImul(a: Integer, b: Integer): Integer {
  return Math.imul(a, b);
}

// More than two doubles, one of them computed: folded pairwise, each bound once.
export function mathMaxOfThree(a: Float, b: Float, c: Float): Float {
  return Math.max(a, Math.abs(b), c);
}

export function mathMinOfThree(a: Float, b: Float, c: Float): Float {
  return Math.min(a, Math.abs(b), c);
}
