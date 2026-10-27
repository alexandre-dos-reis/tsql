---
"@adr/tsql": minor
---

Compile eight members of `Math`: `abs`, `ceil`, `floor`, `trunc`, `sign`, `sqrt`, `min` and `max`.

Each is a PostgreSQL function that returns the same double for the same input,
so the SQL is the call under its own name — `Math.floor(x)` is `floor(x)`,
`Math.max(a, b)` is `greatest(a, b)` — with nothing rewritten. They were chosen by
measuring every `Math` function on 40 016 finite inputs in V8, JavaScriptCore and
PostgreSQL 18, bit by bit; these eight did not differ at all.

`Math.abs` of an `Integer` needs `int(...)`, like unary `-` (`abs(-2147483648)`
raises in PostgreSQL only). Arguments must be numbers that cannot be null, with
no spread, and `Math.max()` with no argument is refused.

Two differences remain, and are documented in `docs/design.md` ("Math"):
`Math.sqrt` of a negative number is `NaN` in TypeScript and an error in
PostgreSQL (the parity harness finds it; guard the input), and a `NaN` argument
gives a different answer for `Math.min` (`LEAST` ignores it) and `Math.sign`
(`sign('NaN')` is `0`) — the harness generates no `NaN`. The other six agree on
NaN and the infinities. The sign of a zero can also differ, which the harness
cannot see.

Every other member is still refused, now with its reason and the list that does
compile: `round` (PostgreSQL rounds a tie to even), `random` (not pure), and the
approximated functions (`sin`, `exp`, `pow`…), whose last bits differ between
engines. The constants (`Math.PI`…) are unchanged.
