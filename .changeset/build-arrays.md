---
"@adr/tsql": minor
---

Build and return arrays. An array literal compiles to `ARRAY[…]::t[]` runs and spreads joined by `||`, so `[...acc, x]` copies and appends, and `filter`/`map` are written as a loop over a `let acc: readonly T[] = []`. Functions may return `readonly T[]` (`RETURNS t[]`), and an array read off a call works like any other (`f(xs).length`). The element type comes from the position — `[]` needs one — and numeric elements widen by an array cast (`readonly Integer[]` where `readonly number[]` is expected). `null` now takes the type its position expects, so `return null` in a function returning `T | null` compiles instead of being refused as a `boolean`. Holes (`[1, , 2]`) and an untyped `[]` are refused.
