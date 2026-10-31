// `Number.parseFloat` is a parser, not a cast: it reads the longest prefix that
// is a number and ignores the rest, so `"3.14abc"` is 3.14 where
// `'3.14abc'::double precision` raises.
//
// Its result is a `Float`, and no `int(...)` stands in front of it: `NaN` for
// text it cannot read, and the two infinities, are values of a `double
// precision` as they are of a `number`. Past the double range, where PostgreSQL
// would raise, the helper answers `±Infinity` or `±0` as JavaScript does.
import type { Float } from "@adrdp/tsql";

export function readFloat(text: string): Float {
  return Number.parseFloat(text);
}

// An ordinary `Float`, usable in arithmetic: the division is a double division.
export function readHalf(text: string): Float {
  return Number.parseFloat(text) / 2;
}
