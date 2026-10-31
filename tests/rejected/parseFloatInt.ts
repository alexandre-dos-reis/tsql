/**
 * Rejected: `int(...)` around `Number.parseFloat`.
 *
 * `Number.parseFloat` is a `Float` — `NaN`, the infinities and a fraction are
 * all values of one — so the cast `int` stands for would round where TypeScript
 * threw: `parseFloat("12.9")` is `12.9`, and `int` throws on it, where
 * `12.9::integer` is 13. That is the divergence `int` exists to remove, so it
 * is refused for a `Float` like any other. `Number.parseInt`, whose value is
 * necessarily whole, is the one that takes `int(...)`.
 *
 * Expected: `int` guards `integer` arithmetic, but this is `double precision`
 */
import { int, type Integer } from "@adrdp/tsql";

export function cents(text: string): Integer {
  return int(Number.parseFloat(text)); // ← rejected here
}
