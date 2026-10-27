---
"@adr/tsql": minor
---

Compile eight members of `Math`: `abs`, `ceil`, `floor`, `trunc`, `sign`, `sqrt`, `min` and `max`.

Five are a PostgreSQL function under the same name (`Math.floor(x)` is
`floor(x)`, `Math.max(a, b)` is `greatest(a, b)`). Three are written another way,
because PostgreSQL answers a special value differently: `Math.min` of doubles is
`-greatest(-a, -b)` (`LEAST` skips a `NaN`), `Math.sign` hands back a `NaN` or a
zero as it is, and `Math.sqrt` of a negative number is `NaN` instead of an error.
Every member was measured on 40 016 finite inputs in V8, JavaScriptCore and
PostgreSQL 18, and on `NaN`, the infinities and both zeros with `Object.is`.

`Math.abs` of an `Integer` needs `int(...)`, like unary `-`. Arguments must be
numbers that cannot be null, with no spread, and `Math.max()` with no argument is
refused. One residual: `Math.min`/`Math.max` of `0` and `-0` may return the other
zero.

An emitter fix rides along: `-(-x)` was written `--x`, which SQL reads as a comment.

Every other member is still refused, with its reason: `round` (ties to even),
`random` (not pure), and the approximated functions (`sin`, `exp`, `pow`…).
