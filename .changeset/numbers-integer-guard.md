---
"@adr/tsql": minor
---

Numbers: drop `Numeric`, guard `integer` arithmetic, and make `@adr/tsql` the authoring import

Three related, breaking changes to how numbers are written and where they come from.

**`Numeric` is gone, and so is PostgreSQL's `numeric`.** It is exact decimal arithmetic, which cannot
agree with the IEEE-754 double TypeScript computes in: `24.41 + -314.26` is `-289.85` in PostgreSQL
and `-289.84999999999997` in TypeScript. No cast or guard reconciles the two, so rather than offer a
type that quietly diverges the compiler no longer offers it — `"numeric"` is not in `PgScalar` at
all, so no path can produce it. `Integer` and `Float` remain. For money, count in integer minor units
or keep the arithmetic in the database.

**`integer` arithmetic now requires the `int(...)` guard.** PostgreSQL raises `integer out of range`
past 32 bits where TypeScript carries on into the doubles beyond — the one divergence the compiler
cannot close by choosing a translation, because the gap is on the TypeScript side and nothing the
compiler emits runs there. Every `+`, `-`, `*` or unary `-` yielding an `integer` must now sit
directly inside `int(...)`, which raises in TypeScript and is **erased** from the emitted SQL:

```ts
import { int, type Integer } from "@adr/tsql";

export function seatTotalCents(seats: Integer, unitCents: Integer): Integer {
  return int(seats * unitCents); // RETURN seats * unit_cents;
}
```

One guard per operation — `int(a + int(b * c))`, since PostgreSQL raises on the inner product even
when the sum would fit. `%` and `/` are exempt. A compound assignment has nowhere to put a guard, so
`total += 200` and `i++` are refused in favour of `total = int(total + 200)` and `i = int(i + 1)`.
Annotating the result `Float` is the other way out: doubles agree with no guard. The parity harness
now counts *both* sides raising as agreement, which is what makes the guard worth writing; one side
raising alone is still reported as a divergence.

**The authoring vocabulary moved to the package root.** `import { int, type Integer } from "@adr/tsql"`
replaces `@adr/tsql/pgtypes`, and the `./pgtypes` subpath is removed. The compiler-as-library export
(`compileProject`, `formatResult`, the IR types) is removed with it: `tsql` on the command line is
the whole public surface for running a build. This also fixes the error that prompted the change — a
compiled project type checks the root module under `types: []` with no DOM, so a root that reached
the compiler put `process` and `node:path` into every consumer's build as type errors. Keeping the
compiler out of the root makes that structural.
