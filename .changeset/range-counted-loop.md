---
"@adr/tsql": minor
---

`range(a, b)`: PostgreSQL's counted loop, with no guard on its step

Requiring `int(...)` around `integer` arithmetic left the commonest loop in the
language paying for it — `for (let i = 0; i < n; i = int(i + 1))` — because a
`for` lowers to `WHILE` with the step as written, and nothing in that shape
proves the counter stays inside 32 bits.

PostgreSQL already has the loop that is wanted, so it is now accepted as itself:

```ts
import { range, int, type Integer } from "@adr/tsql";

export function rangeSum(n: Integer): Integer {
  let total = 0;
  for (const i of range(1, n)) {
    total = int(total + i);
  }
  return total;
}
```

```sql
FOR i IN 1..n LOOP
  total := total + i;
END LOOP;
```

**Both bounds are included**, because SQL's `a..b` includes both — this is
PL/pgSQL's range, not the half-open one other languages spell the same way. The
mapping is exact: the bounds are evaluated once, `b` below `a` iterates nothing
in either language, and the counter **stops at `b`**, so it cannot leave 32 bits
however large `b` is. That is what earns the step its exemption — a proof about
a PostgreSQL construct rather than an inference about the author's arithmetic.

The loop variable must be `const`: PL/pgSQL declares it itself, scoped to the
loop, so a reassignable one would promise something the SQL does not do, and
requiring `const` hands the check to `tsc` the way requiring `readonly` does for
array parameters. `range` is legal only as the iterable of a `for … of` — a
sequence is not a value PostgreSQL can hold. The loop *body* is unaffected and
still needs its guard, since a sum can overflow when the counter cannot.

Refusing `i++` now names the rewrite, with the bounds as written:
`for (let i = 0; i <= limit; i++)` points at `range(0, limit)`, and a strict
`i < limit` at `range(0, int(limit - 1))`, since `range` has no half-open form.
