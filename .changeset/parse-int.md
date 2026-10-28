---
"@adrdp/tsql": minor
---

Compile `Number.parseInt`. It must sit inside `int(...)` and is then an `Integer`: `int(Number.parseInt(text, 10))` reads base ten, and `int(Number.parseInt(text))` reads a leading `0x` as hexadecimal exactly as TypeScript does. It is a parser rather than a cast — the prefix is read and the rest ignored, so `parseInt("12abc")` is `12` where `'12abc'::integer` raises.

`int` is what makes the two sides agree. `Number.parseInt` answers `NaN` for text it cannot read and is not bounded by 32 bits; `int` throws on both in TypeScript, and the helper returns `integer` and raises on both in PostgreSQL — so they agree, including by both raising. Unguarded, `Number.parseInt` is refused with a message naming the rewrite. `int()` around arbitrary `Float` arithmetic is still refused: the cast and `int` differ on a fraction, which `parseInt` cannot produce but arithmetic can.

The SQL was measured against V8 on 48 inputs through both forms — whitespace, signs, trailing garbage, `-0`, the rounding ties past 2^53, the exact boundary where a double becomes `Infinity`, and a 200,001-digit argument — and that grid is a test, because the parity harness draws arbitrary text that almost never parses. Three places a naive translation would have diverged are closed: overflow *raises* in PostgreSQL where JavaScript gives `Infinity`, `numeric` has no negative zero, and an `0x` prefix with no digits after it is `NaN` rather than `0`. Refused with a message: any other radix, a radix that is not a literal, and every other member of `Number` — `Number.isNaN` now says to write `x !== x`, and `Number.isInteger` to write `Math.floor(x) === x`, instead of being refused as an unnamed runtime global.

Adds the `tsql.number_parse_int(text, integer)` helper, which takes the radix as JavaScript does — 10 for base ten, 0 for an omitted one — and inlines, which takes the runtime to **revision 2**. No existing helper changed its body, so nothing a `Math` function returned before changes now; a migration installs the new helpers only when a compiled function calls them.
