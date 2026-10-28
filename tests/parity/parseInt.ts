// `Number.parseInt` is a parser, not a cast: it reads the prefix it understands
// and ignores the rest, so `'12abc'` is 12 where `'12abc'::integer` raises. The
// result is a `Float` because it can be `NaN`, and because it is not bounded by
// 32 bits. With no radix a leading `0x` is read as hexadecimal; with the literal
// `10` it is not, and reading stops at the `x`.
import type { Float } from "@adrdp/tsql";

export function readNumber(text: string): Float {
  return Number.parseInt(text);
}

export function readDecimal(text: string): Float {
  return Number.parseInt(text, 10);
}

export function readOrZero(text: string): Float {
  const value = Number.parseInt(text, 10);
  return value === value ? value : 0;
}
