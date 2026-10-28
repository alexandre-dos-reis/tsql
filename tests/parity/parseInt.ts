// `Number.parseInt` is a parser, not a cast: it reads the prefix it understands
// and ignores the rest, so `'12abc'` is 12 where `'12abc'::integer` raises.
//
// It must sit inside `int(...)`, which makes it an `Integer`. It answers `NaN`
// for text it cannot read and is not bounded by 32 bits; `int` raises on both,
// and so does the cast the guard becomes — so the two sides agree, including
// when they agree by both raising.
//
// With no radix a leading `0x` is read as hexadecimal; with the literal `10` it
// is not, and reading stops at the `x`.
import { int, type Integer } from "@adrdp/tsql";

export function readNumber(text: string): Integer {
  return int(Number.parseInt(text));
}

export function readDecimal(text: string): Integer {
  return int(Number.parseInt(text, 10));
}

export function readTwice(a: string, b: string): Integer {
  return int(int(Number.parseInt(a, 10)) + int(Number.parseInt(b, 10)));
}
