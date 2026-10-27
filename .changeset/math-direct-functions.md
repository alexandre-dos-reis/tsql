---
"@adr/tsql": minor
---

Compile `Math`: `abs`, `ceil`, `floor`, `trunc`, `round`, `sign`, `sqrt`, `fround`,
`min`, `max`, `clz32`, `imul`, and the constants (`Math.PI`, `E`, `LN2`, `LN10`,
`LOG2E`, `LOG10E`, `SQRT2`, `SQRT1_2`).

Each returns the same double as JavaScript for every input, including `NaN`, the
infinities and `-0`. Where PostgreSQL's own function would not, the SQL is written
another way: `round` sends ties up (`round(2.5)` is 2 in PostgreSQL), `min` of
doubles is `-greatest(-a, -b)` (`LEAST` skips a `NaN`) and decides between `0` and
`-0`, `sign` hands a `NaN` or a zero back as it is, `sqrt` of a negative number is
`NaN` instead of an error, `fround` returns `Infinity` or `0` where the cast to
`real` raises. An argument a rewrite reads several times is evaluated once.
Measured with V8, JavaScriptCore and PostgreSQL 18, then on the special values with
`Object.is` (`tests/specialValues.test.ts`).

`Math.abs` of an `Integer` needs `int(...)`, like unary `-`. `clz32` and `imul` take
`Integer`s. Arguments must be numbers that cannot be null, with no spread, and
`Math.max()` with no argument is refused.

The functions whose last bits depend on the engine (`sin`, `exp`, `pow`, `atan2`…),
`hypot`, `log2`, `log1p`, `expm1` and `random` are still refused, with their reason.

An emitter fix rides along: `-(-x)` was written `--x`, which SQL reads as a comment.
