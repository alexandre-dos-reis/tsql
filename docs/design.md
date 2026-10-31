# Design

The [README](../README.md) is how to use tsql. This is *why* it behaves as it does: the reasoning
behind each restriction and each semantic mapping. You do not need it to use `tsql`, but you will want
it before changing how it behaves — most of what looks like a missing feature is a deliberate
rejection, recorded here.

## A few translations

**Null means null.** `??` becomes `COALESCE`, and an absent discount stays distinct from a zero one:

```ts
export function priceCents(listCents: Integer, percentOff: Float | null): Float {
  const discount = percentOff ?? 0;
  return (listCents * (100 - discount)) / 100;
}
```

```sql
DECLARE
  discount double precision;
BEGIN
  discount := COALESCE(percent_off, 0);
  RETURN list_cents * (100 - discount) / 100;
```

**Nullable comparisons are handled for you.** `x !== ""` on a nullable value is not `<>` — SQL's `=` is three-valued, so this would silently return NULL:

```ts
export function isNotEmpty(couponCode: string | null): boolean {
  if (couponCode === null) {
    return false;
  }
  return couponCode !== "";
}
```

```sql
IF coupon_code IS NULL THEN
  RETURN false;
END IF;
RETURN coupon_code IS DISTINCT FROM '';
```

**Objects become composite types**, and functions can call each other:

```ts
type Subscription = { plan: Plan };

export function canCreateTodo(sub: Subscription, count: Integer): boolean {
  const limit = todoLimit(sub.plan);
  return count < limit;
}
```

```sql
DECLARE
  "limit" integer;
BEGIN
  "limit" := app.todo_limit((sub).plan);
  RETURN count < "limit";
```

(`limit` is a reserved word in PostgreSQL, so it gets quoted. You don't have to think about it.)

**`switch` becomes a `CASE`**, and the `default` is required. TypeScript may know `tier` is one of four strings, but PostgreSQL only sees `text`, so something has to answer for any other value — and a `CASE` with no `ELSE` would raise instead:

```ts
export function seatLimit(tier: Tier, extraSeats: Integer): Integer {
  switch (tier) {
    case "free":
    case "starter":
      return 1;
    case "pro":
      return 10 + extraSeats;
    default:
      return 100 + extraSeats * 2;
  }
}
```

```sql
RETURN CASE tier
  WHEN 'free' THEN 1
  WHEN 'starter' THEN 1
  WHEN 'pro' THEN 10 + extra_seats
  ELSE 100 + extra_seats * 2
END;
```

When every branch only returns a value, as here, the `switch` becomes a single `RETURN CASE … END`. A branch that does more — a `const`, a nested `if` — keeps the PL/pgSQL `CASE … END CASE` statement, where grouped labels share one `WHEN 'free', 'starter'`.

## It refuses rather than guesses

Every rejection is a thing that *looks* fine and would have compiled to subtly wrong SQL:

```
functions/billing.ts:2:7 - An `if` condition must be a boolean, not `text`.
                       Truthiness is not translated — compare explicitly.

    2 |   if (name) {
      |       ^
```

A few others: a `switch` without `default` (PostgreSQL does not enforce a union's values, so the `CASE` could match nothing), `a < b` on strings (PostgreSQL would order by collation, TypeScript by UTF-16), `%` on a float (no such operator in PostgreSQL), `Math.round` (PostgreSQL rounds a tie to the even neighbour, JavaScript rounds it up), mutating a field of a parameter (PL/pgSQL passes by value, so the change would vanish). [The full list is below.](#rejected-at-build-time)

## Semantics that are decided, not inferred

- **Equality against nullable values** compiles to `IS [NOT] DISTINCT FROM`, not `=` / `<>`. TypeScript's `===` is total; SQL's `=` is three-valued, and `x = NULL` is `NULL`. Non-nullable operands still get plain `=` / `<>`.
- **`x === null`** becomes `IS NULL` rather than a comparison.
- **`switch`** becomes a `CASE` — the expression `RETURN CASE … END` when every branch only returns a value, the PL/pgSQL `CASE … END CASE` statement otherwise — and **needs a `default`**. A `CASE` that matches nothing raises `CASE_NOT_FOUND`, and TypeScript's exhaustiveness does not carry over: `switch (plan)` may cover `"free" \| "pro"`, and even when `Plan` is a domain or an enum that PostgreSQL enforces, a `CASE` over it is still checked by the database at runtime, not at compile time. The `default` becomes the `ELSE` wherever it is written, so the generated function can never raise. Labels match with `===`: the simple form `CASE plan WHEN 'free', 'pro'` is used whenever no label can be NULL — a NULL discriminant matches no `WHEN` and reaches the `ELSE`, as `null === "free"` is false — and `case null` (or a nullable label) switches to the searched form, `CASE WHEN plan IS NULL`, with the equality rules above. Empty clauses group their labels; any other fallthrough is rejected, so a clause with statements must end in `break`, always return, or be the last one.
- **Division** always produces `double precision`, with the dividend cast when needed: `7 / 2` is `3.5` in TypeScript but integer division in PostgreSQL.
- **Fractional literals** are emitted as `1.5::double precision`, because an unadorned `1.5` is `numeric` in PostgreSQL — exact decimal rather than the IEEE-754 double TypeScript computed with. Whole numbers within 32 bits are `integer` and widen implicitly; wider ones are cast too, since PostgreSQL would read them as `bigint`. See [Numbers](#numbers).
- **`&&` / `||`** require boolean operands. TypeScript returns the operand value, which SQL cannot express.
- **Text concatenation** requires non-nullable operands: `'a' || NULL` is `NULL` in SQL but `"anull"` in TypeScript.
- **Template literals** are concatenation: `` `${plan}-${region}` `` is `plan || '-' || region` (an enum is cast `::text` first, which writes its label). Their substitutions follow the same rule — never nullable — and only types written the same way by `String(value)` and `::text` are accepted: text, `Integer` and `boolean` (`42::text` is `'42'`, `true::text` is `'true'`). Fractional numbers are refused, because the two languages print them differently: `String(0.1 + 0.2)` is `0.30000000000000004`, and a `numeric` keeps its trailing zeros (`1.10`).
- **Named closed sets of strings are enforced by the database.** A union alias is a domain; an `as const` object or a string `enum` is an enum — see [Named types](#named-types-domains-and-enums). An anonymous union written in a signature stays `text`, with its values recorded in a comment, since there is no name to give a type.
- **Identifiers** are mapped to `snake_case`, and quoted when they collide with a reserved word — `const limit` becomes `"limit"`.

### Known divergence

**An out-of-range `Integer` argument.** `Integer` is an alias of `number`, so TypeScript accepts any
double where one is wanted; PostgreSQL rejects it when it binds the parameter, before the body runs:

```
shardOf(3000000000)        // id % 16
  TypeScript  0
  PostgreSQL  ERROR: value "3000000000" is out of range for type integer
```

[The `int` guard](#the-int-guard) does not cover this — it guards arithmetic *results*, and here the
arithmetic is fine; it is the argument that cannot exist in PostgreSQL. Nor can the compiler close it,
for the same reason it cannot close the arithmetic case on its own, only more so: the call site is in
the caller's code, which tsql never sees. The remedy belongs to the caller, and it is the same
function — `shardOf(int(id))` raises in TypeScript exactly where PostgreSQL would. Read `int` as the
assertion for `Integer` at any boundary, not only around arithmetic.

The parity harness generates integers well inside the range (±1e6) and so does not provoke this; that
bound is chosen to keep values being compared rather than raises, which `src/parity.ts` explains.

PostgreSQL raises on `double precision` underflow — a result too small to represent, such as `5e-324 / 10`, is the error `value out of range: underflow` — where TypeScript quietly gives 0 (and on overflow, where TypeScript gives `Infinity`). The parity harness generates doubles away from the subnormal range and within ±1e9 for the same reason.

## Numbers

TypeScript has one number type: the IEEE-754 double. PostgreSQL has several, and they are not
interchangeable — so the author says which one is meant, and the compiler offers only the two whose
behaviour it can preserve.

| alias | PostgreSQL | agrees with TypeScript |
| --- | --- | --- |
| `Integer` | `integer` | exactly, inside 32 bits — past them see [the guard](#the-int-guard) |
| `Float` | `double precision` | exactly, always: the same bits, the same rounding |

Both are plain aliases of `number`, so they cost nothing at a call site. They are resolved **by name**
at build time, which is why the compiler checks [which package declared the
name](#keeping-integer-honest-once-installed). `INT4_MIN` and `INT4_MAX` are exported alongside them —
the compiler reads its own range checks from there, so there is one declaration of the bounds, and a
caller validating input before it reaches a compiled function can use the same two numbers.

### Comparing a `Float` that is `NaN`

PostgreSQL gives `NaN` a place in the order: it equals itself and sorts above every number. JavaScript gives it none: `NaN === NaN` and every `<`, `<=`, `>`, `>=` with a `NaN` are false. Left alone, `count > 10` would be true in the database for a `NaN`, with the function otherwise correct. So a comparison with an operand that can be `NaN` carries the check for the side that PostgreSQL gets wrong, and only that side:

| TypeScript | PL/pgSQL |
| --- | --- |
| `x > y`, `x >= y` | `x > y AND x <> 'NaN'::double precision` |
| `x < y`, `x <= y` | `x < y AND y <> 'NaN'::double precision` |
| `x === y` | `x = y AND x <> 'NaN'::double precision` (`IS NOT DISTINCT FROM` / `IS DISTINCT FROM` when nullable) |
| `x !== y` | `x <> y OR x = 'NaN'::double precision` (`x !== x` is the test for `NaN`, and stays one) |

A literal or an `Integer` cannot be `NaN`, so a comparison whose checked side is one is left as it is (`count > 10` is checked, `10 > x` is not). The checked operand is written twice; it has no effect, so only its cost doubles. The cost of choosing this over leaving the divergence is a longer line on every `Float` comparison. `tests/parity/nanComparison.ts` is run on `NaN` strictly (`tests/specialValues.test.ts`), and the parity harness draws `NaN`, both infinities and `-0` itself.

### Why `Float` and not `DoublePrecision`

`Integer` is PostgreSQL's canonical name, CamelCased. `Float` is not — `'float'::regtype` canonicalises
to `double precision` — so the pair does not follow one rule, and that was weighed rather than
overlooked. The canonical spelling has a space in it, so the exact name is not a TypeScript
identifier; the candidates were `DoublePrecision` and PostgreSQL's own short alias `Float8`.

`Float` is kept because it is what an author writing TypeScript reaches for, and because `float` is a
spelling PostgreSQL does accept — this is the authoring vocabulary, read at every annotation, and
familiarity wins over a rule that would otherwise need no explaining.

The cost, recorded so it is not rediscovered: **`Float` does not say its width.** PostgreSQL also has
`float4`, which is `real`. `Float` is always `double precision` — 8 bytes, the IEEE-754 double
TypeScript computes in — and never `real`, which the compiler does not offer at all, because nothing
in TypeScript corresponds to a 4-byte float.

### Why there is no `Numeric`

PostgreSQL's `numeric` is exact decimal arithmetic. That is a different number system from the double
TypeScript computes in, and the two disagree on ordinary input:

```ts
export function addNumeric(a: Numeric, b: Numeric): Numeric {
  return a + b; // if `Numeric` existed
}
```

```
addNumeric(24.41, -314.26)
  TypeScript  -289.84999999999997
  PostgreSQL  -289.85
```

Neither is wrong; they are not the same answer. `numeric` also carries a scale, so it keeps trailing
zeros (`1.10`) where `String(1.1)` does not — which is why fractional values are refused in template
literals. There is no cast or guard that reconciles exact decimal with binary floating point, so
rather than offer a type that quietly diverges, the compiler does not offer it. `numeric` is not in
`PgScalar` at all: no path through the compiler can produce it.

Money is the usual reason to want it. The answer is to count in integer minor units (`priceCents:
Integer`), or to keep the arithmetic in the database, where `numeric` is the right type and nothing
has to agree with a double.

### The `int` guard

`integer` is exact in both languages, but only across 32 bits. Past them PostgreSQL raises and
TypeScript does not:

```
2147483647 + 1
  TypeScript  2147483648
  PostgreSQL  ERROR: integer out of range
```

This is the one divergence the compiler cannot close by choosing a translation, because the gap is on
the *TypeScript* side and nothing the compiler emits runs there. Narrowing `Integer` to a checked
domain was the idea recorded here for a long time; it does not work, because a domain constrains what
PostgreSQL stores, not what TypeScript computes.

So the author closes it, with a function from the authoring module that raises where PostgreSQL
already raises:

```ts
import { int, type Integer } from "@adrdp/tsql";

export function seatTotalCents(seats: Integer, unitCents: Integer): Integer {
  return int(seats * unitCents);
}
```

```sql
RETURN seats * unit_cents;
```

The guard **leaves no trace in the SQL**. It is not a cast and not a check — PostgreSQL does this
already — it exists so that the two implementations raise on the same inputs. The parity harness
counts *both* sides raising as agreement, which is what makes the guard worth writing; one side
raising alone is still a divergence, and `tests/divergent/unguardedOverflow.ts` is the negative
control that keeps it so.

It is **required**, not offered. Any `+`, `-`, `*` or unary `-` whose result is an `integer` must sit
directly inside `int(...)`, or the build fails. Three consequences follow:

- **One guard per operation.** `int(a + b * c)` is refused: PostgreSQL raises on the inner product
  even when the sum would have fitted, so the two programs would differ in *where* they raise. Write
  `int(a + int(b * c))`.
- **A compound assignment has nowhere to put it.** `total += 200` and `i++` are statements, so
  `int(...)` cannot wrap them. They are refused in favour of `total = int(total + 200)` and
  `i = int(i + 1)` — including a `for` step, since a `for` lowers to `WHILE` with the step as
  written and nothing proves `i < limit` bounds it (`i <= 2147483647` would overflow on the last
  step).
- **`%` and `/` are exempt.** A remainder is smaller than its divisor, so it cannot overflow;
  division already yields `double precision`. Neither needs a guard.

The way out of the verbosity is the other type: annotate the result `Float` and both languages
compute in the same doubles, with nothing to guard. That is a real choice about which arithmetic is
wanted, which is the point.

`int` is recognised the same way `Integer` is — by asking which package declared it, never by name —
so a consumer's own `int` is an ordinary uncompiled function, not something the compiler erases.

### Literals

A whole literal is an `integer` only inside 32 bits. `3000000000` is exact in TypeScript (every
integer up to 2^53 fits in a double) but has no `integer` to live in, so where one is wanted it is
refused outright rather than reported as a narrowing — it is out of range, not merely fractional.
In a `Float` position it is emitted `3000000000::double precision`, because PostgreSQL would
otherwise read it as `bigint`.

## Math

Every member of `Math` whose result can be the **same double** as JavaScript's, for every input including `NaN`, the infinities and `-0`, compiles; the others are refused. The members are a closed table in [`src/globals/math.ts`](../src/math.ts). `Math` itself is recognised by provenance, so a parameter or a module-level value called `Math` is not mistaken for it, and a member the table does not list is refused — anything `Math` grows later stays out until someone adds it and measures it.

| TypeScript | SQL | note |
| --- | --- | --- |
| `Math.abs(x)` | `abs(x)` | the argument's own type; an `Integer` needs [the guard](#the-int-guard) |
| `Math.floor(x)`, `Math.ceil(x)`, `Math.trunc(x)` | the same names | always `Float`; an `Integer` is widened first (`floor(x::double precision)`), so no overload is left for PostgreSQL to pick |
| `Math.round(x)` | `tsql.math_round(x)` | PostgreSQL's `round` sends a tie to the even neighbour (`round(2.5)` is 2), `Math.round` up (3); `-0` is kept for -0.5 ≤ x < 0 |
| `Math.sign(x)` | `tsql.math_sign(x)` | `sign('NaN')` and `sign(-0)` are 0 |
| `Math.sqrt(x)` | `tsql.math_sqrt(x)` | PostgreSQL raises on a negative |
| `Math.fround(x)` | `tsql.math_fround(x)` | PostgreSQL's cast to `real` raises beyond its range, where `fround` gives `Infinity` or `0` |
| `Math.max(a, b, …)`, `Math.min(a, b, …)` | `greatest(…)`, `least(…)` for `Integer`s | the widest of the arguments, each widened to it |
| the same on doubles | `tsql.math_max(a, b)`, `tsql.math_min(a, b)`, nested left to right | `LEAST` skips a `NaN`; `GREATEST`/`LEAST` return whichever zero came first where JavaScript orders `-0` below `0` |
| `Math.clz32(x)`, `Math.imul(a, b)` | `tsql.math_clz32(x)`, `tsql.math_imul(a, b)` | `Integer` arguments only: a `Float` would first be truncated and wrapped modulo 2^32, which tsql does not reproduce |
| `Math.PI`, `E`, `LN2`, `LN10`, `LOG2E`, `LOG10E`, `SQRT2`, `SQRT1_2` | a `double precision` literal | read from `Math` itself, so the bits are JavaScript's |

The `tsql.…` functions are installed by the migration itself; [the next section](#the-tsql-schema) says how.

### Why these, and not the others

This was measured, not assumed. Each function ran on 40 016 inputs (uniform over several ranges, ties, and the awkward values — `0.49999999999999994`, `2^52 + 1`) in Node 22 (V8), Bun 1.4.4 (JavaScriptCore) and PostgreSQL 18.6 through PGlite 0.5.11, bit by bit; then on `NaN`, both infinities, both zeros and the edges of `real`, compared with `Object.is`.

- **The members above agree on all of it.** They are operations IEEE-754 defines exactly, so they do not depend on a platform's `libm`. Each rewrite exists because a measured input needed it (the table's note column).
- **`sin`, `cos`, `exp`, `log`, `pow`, `atan2`, `cbrt` and the like cannot be promised.** ECMAScript only asks for an approximation, and V8 and JavaScriptCore already disagreed with each other on between 2 and 3 535 of the 40 016 inputs, depending on the function. PostgreSQL uses the platform's `libm`, so a third answer is possible. No SQL expression changes that; reproducing one engine's algorithm in PL/pgSQL would still disagree with the other. (PGlite is WebAssembly on musl, not a native PostgreSQL on glibc, so the PostgreSQL column of the approximated group is indicative; the exact group does not depend on it.)
- **`Math.random`** gives a different answer for the same arguments. **`hypot`** overflows as `sqrt(x*x + y*y)` where it does not and rounds differently; **`log2`**, **`log1p`** and **`expm1`** have no PostgreSQL function for `double precision`, and the arithmetic substitutes do not return the same bits.

Each refusal says which of these it is.

### What lowering proves

- **Every argument is a number that cannot be null.** `GREATEST` and `LEAST` skip NULLs where `Math.max` and `Math.min` have no such thing. TypeScript already refuses a `null` there, so a nullable argument means the two languages no longer see the same program.
- **`abs` of an `Integer` needs `int(...)`.** `abs(-2147483648)` is the one input that overflows, and only in PostgreSQL. It is the same asymmetry as unary `-`, closed the same way: `int(Math.abs(x))`.
- **`clz32` and `imul` take `Integer`s.**
- **No spread, no empty call.** `Math.max(...xs)` supplies a number of arguments unknown at build time, and `Math.max()` is `-Infinity`.

### How it is checked

`tests/parity/mathFunctions.ts` and `mathConstants.ts` go through the fast-check harness like any case. The harness draws `NaN`, both infinities and `-0` among its doubles (about one in ten) and compares with `Object.is`, so `-0` is not `0`; `tests/specialValues.test.ts` also runs every function of those two files on a fixed grid of `NaN`, both infinities, both zeros, ties, `2^52 + 1` and the edges of `real`, strictly with `Object.is`. A rewrite that is wrong only there fails it.

What `Math` cannot change is arithmetic: inside a compiled function PostgreSQL raises where JavaScript makes an infinity or a `NaN` out of finite operands (`1e308 * 10`, `0 / 0`). That is the section on numbers, not `Math`.

## `Number.parseInt`

The behaviour reproduced here is the one written down at
[MDN's `parseInt`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/parseInt),
and every example on that page for the two forms tsql compiles is a test
(`tests/parseIntValues.test.ts`), checked against the *documented* answer rather than against whatever V8
returns — so the SQL is pinned to the language and not to one engine. The examples for a radix tsql refuses
(2, 8, 13, 16, 36) are left out, the compiler rejecting those at build time.


`Number.parseInt` is one of the two members of `Number` that compile (the other is `parseFloat`, below), and it is not a cast. JavaScript reads the
longest prefix it understands and ignores whatever follows, so `parseInt('12abc')` is `12` where
`'12abc'::integer` raises, and `parseInt('')` is `NaN` where the cast raises again. The SQL is therefore a
parser, in the `tsql` schema: `tsql.number_parse_int`.

**It must sit inside `int(...)`, and is then an `Integer`.** The helper returns `double precision`, because
`NaN` and values past 32 bits are among the answers — `NaN` is what *any* unreadable string gives, and ten
digits leave `integer` behind. Neither is representable as an `integer`, so the result is not one until
something has said what becomes of them. `int` is that something: it throws on both in TypeScript, and the
cast it lowers to raises on both in PostgreSQL, so the two sides agree — including when they agree by both
raising, which the parity harness counts as agreement. Unguarded, `Number.parseInt` is refused.

The cast `int` stands for lives **inside the helper**, which therefore returns `integer` outright. The double
is what the arithmetic produces — `NaN` for text with no digits, an infinity past the double range — and
casting it is what raises. Nothing is emitted for the guard at the call site, so `int(...)` erases itself here
exactly as it does around arithmetic. The cast is enough on its own because it already matches `int` on every
value `parseInt` can produce:

| Value | `int()` | `::integer` |
| --- | --- | --- |
| an exact integer in range | the value | the value |
| `NaN`, `±Infinity` | throws | raises |
| past 32 bits | throws | raises |
| **a fraction** | **throws** | **rounds** |

Only the last row disagrees, and `parseInt` cannot produce it: it reads a run of digits and stops at the `.`,
so `"12.9"` is `12`. That is why the rule is narrow — a `Number` member folds the cast into its helper when
its value is *necessarily whole*, which `src/globals/number.ts` records per member as `whole`, not because its
arithmetic happens to be done in a double. `int()` around arbitrary `Float` arithmetic stays refused, for
exactly the fraction case, and a member that could return a fraction would be `whole: false` and stay a
`Float`.

One difference is deliberate and unobservable: `parseInt("-0")` is `-0`, which TypeScript's `int` returns as
it is while `integer` has no negative zero and the cast gives `0`. Nothing an `integer` can do tells them
apart, and `src/parity.ts` already compares ±0 as equal.

The helpers are named for their namespace, like `tsql.math_round`: the `number_` prefix says this is not a
general-purpose SQL function but the SQL that reproduces one JavaScript call exactly — here
`int(Number.parseInt(s))`, the only form the compiler emits, which is why the signature can be
`text → integer` and read as what it is.

**Two forms compile**, because two were measured: `parseInt(s)`, which reads a leading `0x` as hexadecimal,
and `parseInt(s, 10)`, which does not and so stops at the `x`. Any other radix, or one that is not a literal,
is refused — the radix decides which helper the call becomes, so it has to be readable at build time, and the
compiler does not emit SQL whose agreement with TypeScript nobody has checked.

### What the page makes explicit

Three rules are easy to assume wrongly, and all three are tested:

- **A leading zero is not octal.** `parseInt("077")` is 77, in both forms.
- **Only `0x` is auto-detected.** `0b101` reads as `0`, stopping at the `b`; `0o17` likewise. The binary and
  octal prefixes are not recognised, where the hexadecimal one is.
- **Anything invalid stops the read, it does not fail it.** `"15px"`, `"15,123"`, `"15 * 3"`, `"15e2"` and
  `"123_456"` are all 15, 15, 15, 15 and 123 — the exponent and the numeric separator are just invalid
  characters, and `e` is only a digit when the radix makes it one.

### What PostgreSQL does differently

Three things, each closed in the helper and measured against V8 on 48 inputs through both forms:

| | JavaScript | PostgreSQL, written naively | What the helper does |
| --- | --- | --- | --- |
| `'1' + 400 zeros` | `Infinity` | **raises**, `numeric::double precision` overflows | digit count, then an exact compare against the rounding boundary |
| `'-0'`, `'-000'` | `-0` | `0` — `numeric` has no negative zero | answers `-0` directly |
| `'abc'`, `''` | `NaN` | raises, or NULL | `'NaN'::double precision` |

The overflow boundary is exact rather than approximate: a double rounds to infinity from `2^1024 - 2^970`, the
midpoint between the largest double and `2^1024`, and the comparison is made in `numeric` so no rounding
happens before it. `'9'×309` is finite and `'9'×310` is not; one less than the boundary is the largest double
and the boundary itself is `Infinity`. The digit-count guard comes first so a million-digit argument never
builds a `numeric` at all.

The `0x` prefix is detected separately from the digits that follow it, because JavaScript *commits* to base 16
on seeing it: `parseInt('0x')` and `parseInt('0xzz')` are `NaN`, not the `0` that falling back to base ten
would read off the leading zero. That one was found by measurement, not by reading the specification.

### Why the hexadecimal side needs no aggregate

Reading hexadecimal exactly at *any* width takes an aggregate over the digits — which needs a `FROM`, so the
helper would not inline. It does not need to be exact at any width: the helper returns `integer`, and **more
than eight significant hexadecimal digits cannot fit one whatever they are**. That case needs no arithmetic
at all, only a value past the range so the cast at the end raises, which is the answer. Eight or fewer go
through `bit(64)` in one expression, exact.

So the body is one `SELECT` with no `FROM`, and PostgreSQL inlines it. Measured on PGlite over 200 000 rows:
**1.0 µs a call against 15.2 µs** for the aggregate it replaced, a factor of thirteen.

The generality that was lost was never used. It is worth noticing that it only became unnecessary once the
helper returned `integer` rather than a double — while it returned a double it genuinely had to represent
every value `parseInt` can produce, up to the 256 hexadecimal digits where a double becomes `Infinity`.
`tests/helpers.test.ts` checks the inlining, so losing it again fails the build.

The body is written to be read as well as to run: `COALESCE` rather than a `CASE` testing a match for NULL,
so each pattern is named once; the sign as a factor rather than the value written out per sign; the leading
nine hexadecimal digits rather than a length test, so the digits are not written twice to be measured and
then converted; and the whitespace class as a bracket expression with its contiguous runs as ranges, which
also lets the trim live inside each pattern instead of in a separate `ltrim` call. That is 768 characters
against 2 330 for the same behaviour.

What is left is near the floor for a body that inlines: 37% of it is the whitespace class, written once per
pattern, and the four patterns cannot share one trimmed string without binding it — which takes a `FROM` or
a `LATERAL`, and that is exactly what stops PostgreSQL inlining. Two things are being traded against each
other, and the faster one won. With the radix a constant the planner folds the base-choosing branch away entirely, so
`number_parse_int(s, 10)` pays nothing for the hexadecimal side it cannot reach.

## `Number.parseFloat`

The behaviour reproduced is the one written down at
[MDN's `parseFloat`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/parseFloat),
and every example on that page is a test (`tests/parseFloatValues.test.ts`), checked against the documented
answer. Beside them is a fixed grid of about 900 strings — shapes, whitespace and look-alikes of whitespace,
the `Infinity` spellings, signed zeros, rounding, and the exact edges of the double range computed with
`BigInt` — because the parity harness draws arbitrary text, which almost never parses.

Like `parseInt` it is a *parser*, not a cast: JavaScript reads the longest prefix that is a decimal literal
(`"3.14abc"` is `3.14`, `".5"`, `"5."`, `"1e3"` and `"-Infinity"` are all numbers; hexadecimal, `_` separators
and `"1e"` stop the read), and anything unreadable is `NaN`. It lowers to `tsql.number_parse_float(s)`,
`text → double precision`, and **it is a `Float`**: a fraction, `NaN` and the infinities are all among its
answers, so it is `whole: false` in `src/globals/number.ts` and `int(Number.parseFloat(s))` is refused
(`tests/rejected/parseFloatInt.ts`) for the reason `int` is refused around any `Float`. It takes no radix.
Bare `parseFloat(s)` is not supported, as bare `parseInt`: only the `Number` member.

### What PostgreSQL does differently

| | JavaScript | `float8` input | What the helper does |
| --- | --- | --- | --- |
| text after the number | ignored | raises | a pattern reads the literal, the rest is dropped |
| `''`, `'abc'` | `NaN` | raises | `COALESCE(…, 'NaN')` |
| `'1e999'` | `Infinity` | **raises** (overflow) | clamped |
| `'1e-999'` | `0` | **raises** (underflow) | clamped |
| `'-1e-999'` | `-0` | raises | `-0` |
| `'Infinity'`, `'-Infinity'` | ±`Infinity` | accepted | accepted |

The common string never meets the clamp. A guard — fewer than 200 bytes and no exponent of three digits or more
— proves that the cast cannot overflow or underflow, and then the body is one pattern and one cast. Ordered so
a string with no `e` or `E` is settled by two `strpos` and the regular expression is not run. Otherwise the
value is clamped in `numeric`, in units of 2^-1075 (the midpoint under the smallest denormal), because
`2::numeric ^ -1075` is inexact and an integer multiple is not: at most 2^-1075 is `0`, at least
`2^1024 - 2^970` is `Infinity`, the exact rounding boundaries, and everything between goes through the cast. The
sign is read from the matched text, so `-0` and `-Infinity` survive. A simple `CASE` evaluates its subject once.

**Limits, and they are loud.** `numeric` holds 10^-16383 to about 10^130749 once scaled, so a literal beyond
that raises instead of answering `Infinity` or `0` (`1e130749`, `1e-16384`, a hundred-thousand-digit mantissa).
The loud-limits test pins this. A raise is never a wrong answer, and the parity harness counts it as such.

**Inlining.** One `SELECT`, no `FROM`, no `SET`: PostgreSQL inlines it, and `tests/helpers.test.ts` checks the
plan. The argument is read several times, so it inlines only for a cheap argument, which an ordinary expression is.
Measured on PGlite over 200 000 rows, a few µs a call (about 5 to 9 on ordinary input; the plain cast is 0.3
to 2, but raises on a suffix), 26 µs only for three-digit exponents, which take the clamp, and 0.9 µs for
`NaN`. Shorter forms were tried and lost. One that needed a `LATERAL` stopped inlining. Two that inline are shorter
because they read the literal in fewer places: 938 characters with the guard kept, 691 without it, building the
result as text (sign, then `0`, `Infinity` or the number) and casting once. They agree with JavaScript on the
grid, but every `substring` they add costs about 5 µs, so they run at 11.7 and 17 µs on ordinary input against
6.4. The body is 1 178 characters because the common string must meet one pattern and one cast, and the
pattern is written out once for it and once per read in the slow path.

One thing is a test limit, not a helper one: PGlite's WebAssembly build (musl `strtod`) rounds a
~1000-digit string near a denormal tie differently from glibc, V8, JavaScriptCore and Python, which agree
among themselves. Those strings are left out of the grid, and the helper is checked on a real PostgreSQL 18.

## Strings

Of `String.prototype`, six methods compile: `trim`, `trimStart`, `trimEnd`, `includes`, `startsWith` and `endsWith`. They are a closed table in [`src/globals/string.ts`](../src/globals/string.ts), the same shape as [`Math`](#math) and `Number` and for the same reason — the default is to refuse, so what the prototype grows later stays out until someone measures it. Unlike those two there is no global to recognise by provenance: the method is called on a *value*, and what sends lowering to the table is the operand's PostgreSQL type, which it has already worked out. A method on anything else is the categorical refusal it has always been.

| TypeScript | SQL |
| --- | --- |
| `s.trim()` | `btrim(s, U&'\0009\000a…\feff')` |
| `s.trimStart()` | `ltrim(s, …)` |
| `s.trimEnd()` | `rtrim(s, …)` |
| `s.startsWith(t)` | `starts_with(s, t)` |
| `s.includes(t)` | `strpos(s, t) > 0` |
| `s.endsWith(t)` | `starts_with(reverse(s), reverse(t))` |

What the six have in common is that **no locale and no collation decides anything**: the trims are handed the exact set of characters to remove, and the searches compare code points. No helper, and nothing installed in the `tsql` schema: PostgreSQL already has these functions, with the same definitions.

### The searches

A substring search is not a comparison, which is what makes these three translatable where `<` on strings is [refused](#rejected-at-build-time): `strpos`, `starts_with` and `reverse` work on code points and consult no collation. Measured over 3 000 random pairs drawn from an alphabet of astral characters (`😀`, a ZWJ family), precomposed and decomposed `é`, `ß`, dotless `ı`, `İ` and whitespace — with ~40% of the needles genuinely suffixes, so the result is not vacuously `false` — all three disagree with JavaScript on **0** inputs. Lone surrogates and NUL are excluded, as `src/parity.ts` excludes them: they have no PostgreSQL `text` value at all.

The edges are each what makes the written form what it is:

| | JavaScript | SQL |
| --- | --- | --- |
| `s.includes("")` | `true` | `strpos(s,'')` is 1, hence `> 0` and not `>= 1` on an absent needle, which is 0 |
| `s.endsWith("")` | `true` | `reverse('')` is `''`, and `starts_with(x,'')` is `true` |
| a needle with `%` or `_` | an ordinary character | `starts_with`/`strpos` have no pattern syntax — `s LIKE t || '%'` would be wrong here, and is why `startsWith` is not written that way |

**`endsWith` reads each argument once.** PostgreSQL has no `ends_with`, and the obvious `right(s, length(t)) = t` is equally exact (0 disagreements on the same corpus) but mentions the needle *twice*, so `s.endsWith(f(x))` would call the compiled `f` twice — the cost that made the `Math` rewrites into [helpers](#the-tsql-schema). A suffix test is a prefix test on both strings reversed, which mentions each once and stays raw SQL: `tests/parity/stringMethods.sql` pins that `app.trim_both(part)` appears a single time.

**Their second argument is refused.** `includes(t, pos)`, `startsWith(t, pos)` and `endsWith(t, endPos)` take a position counted in **UTF-16 code units**, which is the one thing PostgreSQL's `text` does not have — it counts characters. `"😀a".includes("a", 1)` is `true` in TypeScript, where the second *character* in PostgreSQL is already the `a`. The refusal says so.

### Why the trims' second argument is the whole point

`btrim(s)` with one argument removes **spaces only**, so it would diverge on a tab. The set form removes exactly the characters it is handed, which buys two things:

- **It is the same set JavaScript uses.** ECMAScript's `trim` removes `WhiteSpace` and `LineTerminator`: the tab, vertical tab, form feed, U+FEFF, Unicode's `Space_Separator` category, LF, CR, U+2028 and U+2029 — 25 code points, all in the BMP.
- **No locale, no collation.** `btrim` with a character set compares code points. That is exactly what keeps `toUpperCase` out: `upper()` follows the *database's* locale and collation rules where TypeScript follows Unicode's case mapping, and neither maps `ß` to `SS` the way the other does.

The 25 are a written-out table rather than something derived at run time, because deriving it means testing 65 536 code points on every compile. `tests/trimValues.test.ts` does the derivation instead and asserts the table is what the running engine strips, so a Unicode revision that moved a character into `Space_Separator` fails the suite rather than quietly emitting the wrong set.

They are emitted as **Unicode escapes**, `U&'\0009\000a…'`, not as the characters themselves. Twenty-five invisible characters in a migration cannot be read or reviewed, and any editor that strips trailing whitespace on save would change what the function does. (`U&'…'` needs `standard_conforming_strings` on, the default since 9.1, and code points above U+007F need a UTF8 server encoding.) The literal repeats at every call site; that is the price of staying raw SQL with no helper.

### What lowering proves

- **The operand is a `string` that cannot be null.** `btrim(NULL, …)` is NULL where TypeScript raises a `TypeError` on `null.trim()` — a different *outcome*, not a different value. No valid case reaches it: TypeScript refuses `.trim()` on a `string | null` first, and `s!` and `s as string` are refused earlier still.
- **An enum is read as its label.** TypeScript treats an enum member as a string, so it is cast `::text` (`btrim(level::text, …)`), as it is in a concatenation.
- **The result is a plain `string`.** Trimming a union of string literals, a domain or an enum proves nothing about the result still being a member of that type, so it is `text` and not the named type.
- **No arguments.** None of the three takes any.

### Why not the others

Each refusal names the divergence rather than reporting the method missing:

- **`toUpperCase`, `toLowerCase`** — the locale and collation question above, and measured: over 1 500 strings from the same corpus, `upper()` differs from `toUpperCase()` on 227. `'ß'.toUpperCase()` is `"SS"` where `upper('ß')` is `"ẞ"`, and dotless `ı` differs too.
- **`length`, `charCodeAt`, `codePointAt`, `indexOf`, `lastIndexOf`, `slice`, `substring`** — TypeScript counts **UTF-16 code units** and PostgreSQL counts characters, so they disagree on everything outside the BMP (`'😀'.length` is 2 where `length('😀')` is 1). `indexOf` also counts from 0 and answers -1 where `strpos` counts from 1 and answers 0; it and `lastIndexOf` are told to write `includes` or `endsWith` when the position is not what was wanted.
- **`padStart`, `padEnd`** — `lpad` and `rpad` truncate a string longer than the target width, where the JavaScript returns it unchanged: `lpad('abcdefghij', 3, '-')` is `"abc"`. The width is also counted in UTF-16 code units.
- **`repeat`** — exact for a literal non-negative count, but `repeat(s, -1)` is `''` in PostgreSQL where JavaScript throws a `RangeError`, and a count that is not a literal cannot be checked at build time. It is the only refusal here that is a *missing feature* rather than a divergence.
- **`search`, `match`, `replace`** — a regular expression, which is not part of the subset.
- **`split`** — an array of text whose length is not known at build time.
- **`replace`** — PostgreSQL's changes every occurrence where TypeScript's changes the first, and a regular expression is not part of the subset.
- **`normalize`** — PostgreSQL has `normalize()`, but which forms agree has not been measured.
- **`trimLeft`, `trimRight`** — the deprecated aliases are told to write `trimStart` and `trimEnd`.

### How it is checked

`tests/parity/stringMethods.ts` goes through the fast-check harness like any case, which mostly proves the shapes: the harness draws arbitrary text, nearly all printable ASCII, and draws each parameter independently — so a string rarely has whitespace to trim, and two of them are almost never one inside the other. The pinning is two fixed grids, both comparing **inside PostgreSQL** with the expected value sent as a parameter, because a driver drops a leading U+FEFF as it decodes text and comparing in JavaScript would report a divergence the server does not have:

- `tests/trimValues.test.ts` — each of the 25 code points alone, at either end, in runs, around characters that must survive, and the near-misses that must not be trimmed (U+180E, U+200B, U+2060, U+FFFE). Plus the set itself, derived from the running engine over the whole BMP and asserted equal to the table.
- `tests/stringSearchValues.test.ts` — the empty needle, a needle equal to the subject and one longer than it, overlapping and repeated matches, a match at the wrong end only, astral characters, combining marks, and needles made of `%`, `_` and `\`. It also asserts the grid holds both answers for each of the three, so an implementation that always said `false` could not pass.

## The `tsql` schema

A `Math` rewrite has to read its argument several times (`Math.round(x)` is `x - floor(x) >= 0.5 …`). Written out where it is used, that is a line of several hundred characters, and a heavy argument (a call to a compiled function) would either run several times or need a sub-select, which PL/pgSQL no longer evaluates as a simple expression: measured on PGlite, 200 000 calls, 20 µs against 6.6 µs for a helper function and 3.4 µs for an inlined one. So the rewrites are functions in a schema of tsql's own, `tsql`, and a compiled function calls them: `RETURN tsql.math_min(tsql.math_max(x, lo), hi);`.

- **The set is closed** — [`src/helpers.ts`](../src/helpers.ts) — and small: `math_round`, `math_fround`, `math_sign`, `math_sqrt`, `math_min`, `math_max`, `math_clz32`, `math_imul`, `number_parse_int`, `number_parse_float`. They are `LANGUAGE sql`, `IMMUTABLE`, `PARALLEL SAFE`, with no `SET` clause (which would stop PostgreSQL inlining them: a test looks at the plan), and every function they call is written `pg_catalog.…`, so the search path cannot change what they mean.
- **The schema is fixed.** It is not an option and the TypeScript cannot name it; `--schema tsql` is refused. The user's own functions keep `--schema`, which is a deployment decision (PostgREST exposes `public` by default, PostGraphile the schemas it is given), not something tsql should take away.
- **A migration carries the helpers its functions use, not all of them**, before those functions, and none (no schema, no table) when no function calls one. It is the same file on every `compile`: it changes in a diff only when a helper does.
- **The migration brings them up to date itself.** There is no command to run. Its runtime section creates the schema and a one-row table `tsql.runtime(revision)`, then a `DO` block:
  1. refuses the migration if the database holds a **newer** revision than this tsql writes (an older tsql, another application sharing the database, must not overwrite a fix);
  2. `CREATE OR REPLACE`s each helper it uses, and `RAISE NOTICE`s when what was installed had a different body;
  3. records the revision.

  Applying it again changes nothing and says nothing.
- **A helper changes only to fix a bug**, because the JavaScript it matches does not move. A fix is replaced in place, under the same name, so the SQL of the user's functions does not change and nothing needs recompiling. The risk is the user's, and the notice names it: an index, a stored generated column or a materialized view computed with the old body keeps the old values until it is rebuilt, and tsql cannot do that for them — PostgreSQL records no dependency from a function body on the functions it calls, so no query finds those objects.
- **A fix is a decision, so it is locked.** [`src/helpersLock.ts`](../src/helpersLock.ts) holds one hash of the helpers' text per revision, oldest first, and the revision a database records is how many there are. Nobody edits it: `bun scripts/helpers.ts lock` appends the current hash. Changing a body without running it fails `tests/helpers.test.ts` — and so the pre-commit hook and CI — with the command to run; an entry is never rewritten, which is what lets an older tsql recognise a database as newer. The changeset says which `Math` functions behave differently.
- **Privileges are the user's.** tsql grants nothing. The role that applies the migration needs `CREATE` on the database the first time (for the schema), then to own `tsql` and its helpers: `CREATE OR REPLACE FUNCTION` and the `UPDATE` of `tsql.runtime` fail for another role, so every later migration must run as the same one. A role that only *calls* the compiled functions (PostgREST's `anon`, a PostGraphile role) needs `USAGE` on the schema `tsql` — `EXECUTE` on a function defaults to everyone, `USAGE` on a schema does not — so the grant the user already writes for their own schema is written for `tsql` too: `GRANT USAGE ON SCHEMA tsql TO web_anon;`. Without it the call fails with `permission denied for schema tsql`, from inside the user's function.
- **Never dropped.** A helper no function uses any more stays installed: a `DROP` would break any function not recompiled since, with no dependency to warn.

Rejected on the way: helpers whose name carries a revision (`math_round_2`, left behind with the old one, the fix reaching a database only by recompiling) — more to read, and a stale helper staying callable; and a `tsql upgrade` command — a second step to forget, for a change the user's own migration already applies.

## SQL functions, and inlining

A function whose whole body is `return <expression>` is emitted as `LANGUAGE sql` with a SQL-standard body (`RETURN expression;`, PostgreSQL 14 and later); every other function is PL/pgSQL. The reason is the planner. It *inlines* a SQL function: in `WHERE app.above(v)` it sees `v > 990`, so an index on `v` is usable, and a `CHECK`, a generated column or a row-level security policy that calls the function costs no call per row. A PL/pgSQL function is a black box to it. Measured on PGlite (PostgreSQL 18), 300 000 rows and an index on `v`, for the same condition: 369 ms with a sequential scan calling the function on every row, against 3 ms with a bitmap scan on the index. The results are the same; the parity harness runs both languages.

[`src/language.ts`](../src/language.ts) decides, after every function has been lowered, because it needs the call graph. A function stays PL/pgSQL when:

- **it is not one expression**: a local, an `if` or a loop have no SQL-function form;
- **it is part of a cycle of SQL functions**, itself included (recursion): PostgreSQL resolves the calls in a SQL function's body when it *creates* it, so each would have to exist before the other, where PL/pgSQL looks a call up only when it runs;
- **it writes an enum value as a literal**: a migration that adds a value (`ALTER TYPE … ADD VALUE`) and, in the same transaction, replaces a function that names it fails with *unsafe use of new value* for a SQL function, which is analysed when created, and not for PL/pgSQL. `tests/parity.test.ts` ("the migration adds an enum value in its place") is the case that found it.

The same fact orders the migration: a SQL function is created after every function it calls (`creationOrder`), otherwise by name, so a recompile is still byte-identical. A SQL-standard body is parsed when the function is created, so PostgreSQL records what it calls and the types it names as dependencies; a `DROP` of either is refused until the function goes.

## Object types

A named `interface` or `type` object shape becomes a PostgreSQL composite type, and field access becomes a parenthesised field reference:

```ts
type Subscription = { plan: "free" | "pro" | "max" };

export function canCreateTodoWithType(sub: Subscription, count: Integer): boolean {
  const plan = sub.plan;
  if (plan === "free") return count <= 3;
  if (plan === "pro") return count <= 6;
  return count <= 9;
}
```

```sql
DO $$
DECLARE
  expected text[] := ARRAY['plan text'];
  actual text[];
BEGIN
  IF to_regtype('app.subscription') IS NULL THEN
    CREATE TYPE app.subscription AS (
      plan text
    );
  ELSE
    SELECT array_agg(a.attname || ' ' || format_type(a.atttypid, a.atttypmod) ORDER BY a.attnum)
      INTO actual
      FROM pg_attribute a
     WHERE a.attrelid = (SELECT t.typrelid FROM pg_type t WHERE t.oid = to_regtype('app.subscription'))
       AND a.attnum > 0 AND NOT a.attisdropped;
    IF actual IS DISTINCT FROM expected THEN
      RAISE EXCEPTION 'app.subscription exists as % but the functions expect %', actual, expected;
    END IF;
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION app.can_create_todo_with_type(
  sub app.subscription,
  count integer
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  plan text;
BEGIN
  plan := (sub).plan;
  IF plan = 'free' THEN
    RETURN count <= 3;
  END IF;
  ...
```

A field of an object type is a **column of that type's own composite**, exactly as PostgreSQL nests them:

```ts
interface Customer {
  tier: "standard" | "gold";
}

interface Basket {
  customer: Customer;
  total: Integer;
}

return basket.customer.tier;
```

```sql
CREATE TYPE app.customer AS (tier text);
CREATE TYPE app.basket AS (customer app.customer, total integer);

RETURN ((basket).customer).tier;
```

`app.customer` is created first, because `app.basket` needs it. `basket.customer` is a value like any other — passed to a function, returned, held in a local, destructured — and from SQL, PostgREST and PostGraphile it looks like the type the author wrote.

Three rules make this faithful:

| Refused | Why |
| --- | --- |
| an anonymous nested shape, `customer: { tier: string }` | a composite column needs a named type, and inventing one (`app.basket_customer`) would put a type in the schema that nobody wrote — give the shape a name |
| a nullable nested object, `customer: Customer \| null` | `IS NULL` on a composite is also true for a row whose fields are all NULL, so `customer: null` and `customer: { tier: null }` would be indistinguishable — make the field non-nullable, or the nested fields `T \| null` |
| a shape that contains itself, `interface Node { child: Node }` | no fixed depth; PostgreSQL refuses a composite that is a member of itself |

A non-nullable nested object has the same contract as a non-nullable parameter: the caller does not pass NULL, and the function does not check. Field names are mapped to `snake_case`, so `fooBar` and `foo_bar` would be one column: that is a build error, as is a name longer than PostgreSQL's 63-byte limit, which it would otherwise truncate silently.

These were once flattened into prefixed columns (`customer.tier` → `customer_tier`), to avoid the NULL hazard above. But that hazard only bites a *nullable* nested object, which is refused either way, while flattening produced a type nobody wrote, needed collision and depth guards, and made `barOf(outer.foo)` impossible. Nesting as PostgreSQL does is simpler and more honest.

### Object literals and spread

A literal builds a composite with `ROW(...)`, which is how a fresh value is produced without mutating anything:

```ts
export interface Seat {
  plan: "free" | "pro";
  count: number;
}

export function grantSeat(seat: Seat): Seat {
  return { ...seat, count: seat.count + 1 };
}
```

```sql
CREATE OR REPLACE FUNCTION app.grant_seat(seat app.seat)
RETURNS app.seat
...
  RETURN ROW((seat).plan, (seat).count + 1)::app.seat;
```

Fields are matched by name, in source order, so spreads compose with each other, last-one-wins exactly as in JavaScript — and a nested object is rebuilt with a nested literal, a `ROW` inside a `ROW`:

```ts
const next: Mutable = { ...nested, foo: { ...nested.foo, bar: "some" } };
return next.foo.bar;
```

```sql
next := ROW(ROW('some')::app.mutable_leaf)::app.mutable;
RETURN ((next).foo).bar;
```

The inner spread supplies `bar`, then `bar: "some"` overrides it — so the generated row carries the literal, with no intermediate copy to assign into.

Three consequences:

- **A literal needs a named target type.** `ROW(...)` has to be cast to a nominal composite, so the type comes from the contextual type: an annotation, the function's return type, or the parameter being passed to. An unannotated `const x = { ... }` is rejected with that advice.
- **Composite returns work.** PL/pgSQL always returned them fine; the gap was that nothing in the subset could build one. `RETURNS app.seat` compiles, and a field can be read straight off the call: `RETURN (app.grant_seat(seat)).count;`
- **A nested object is a value.** `barOf(outer.foo)` compiles to `app.bar_of((outer).foo)`, and `barOf({ ...outer.foo })` to `app.bar_of(ROW(((outer).foo).bar)::app.content)`.

Field access is resolved as *a composite-typed base plus a path*, not as "a property of a variable", so all four of these read the same way:

| Written | Generated |
| --- | --- |
| `sub.plan` (parameter) | `(sub).plan` |
| `next.foo.bar` (local, nested) | `((next).foo).bar` |
| `grantSeat(seat).count` (call result) | `(app.grant_seat(seat)).count` |
| `{ ...nested.foo }` (nested, in a literal) | `ROW(((nested).foo).bar)::app.leaf` |

Mutating a field is rejected for a sharper reason than the rest: it is not unsupported syntax, it is untranslatable. The same assignment is perfectly legal PL/pgSQL, but parameters there are passed **by value**, so the change never reaches the caller:

```
TS:  returned "some" | caller now holds "some"      <- mutation escapes the function
SQL: returned some, caller still holds original     <- mutation stays on the local copy
```

Compiling it would silently drop a side effect the TypeScript version has. Build a new value with a spread instead; declaring object fields `readonly` gets TypeScript to reject the assignment at authoring time too.

Copying the argument into a fresh local at the top of the generated function — making the SQL internally consistent — was considered and rejected. PL/pgSQL parameters are *already* copies, so the copy is a no-op; and because the two implementations would then agree on every return value, the parity harness would go green while the caller-visible behaviour still differed. The fresh value has to exist in the TypeScript, where both languages can see it.

Four more decisions worth stating:

- **Keyed to the name, not the shape.** TypeScript object types are structural; PostgreSQL composites are nominal. Two structurally identical TypeScript types stay two distinct SQL types rather than being silently unified, and an anonymous `{ plan: string }` is rejected — there would be no name to generate. Types are emitted before the functions that use them, and only if a compiled function actually mentions them.
- **`CREATE TYPE` has no `IF NOT EXISTS`,** so the statement is guarded. The guard also compares the shape that already exists against the expected one and raises, turning a field renamed in TypeScript but never migrated into a loud migration failure rather than a function that quietly returns NULL. Changing a shape still needs a deliberate `ALTER TYPE`: the compiler creates, it never rewrites.
- **`(sub).plan`, not `sub.plan`.** Without the parentheses PostgreSQL reads it as a column reference on a table named `sub`.
- **`===` on an object is rejected.** TypeScript compares objects by identity, SQL compares composites by value — there is no faithful translation, so compare the fields you care about.

Built-in object types are excluded by the same provenance check that catches runtime globals: `Date` and `Error` are interfaces with properties, but they are declared in the standard library, so they are rejected as built-ins rather than turned into composite types.

## Named types: domains and enums

A closed set of strings with a name becomes a PostgreSQL type, so the database refuses a value the
functions do not know — `INSERT … VALUES ('gratuit')` fails, where a `text` column would have taken it and
the function fallen through to its `else`. Which type depends on how the set is written, and the two
choices mirror each other:

| TypeScript | PostgreSQL | Alike in that… |
| --- | --- | --- |
| `type Plan = "free" \| "pro"` | `CREATE DOMAIN app.plan AS text CHECK (…)` | both are **structural**: any matching string is one, with no conversion — `"free"` is a `Plan`, `'free'` is an `app.plan` |
| `const AreaType = { Level1: "level-1", … } as const` and `type AreaType = (typeof AreaType)[keyof typeof AreaType]` | `CREATE TYPE app.area_type AS ENUM ('level-1', …)` | both are a **named vocabulary**, read through its members (`AreaType.Level1`); PostGraphile exposes the enum as a GraphQL enum, PostgREST sorts and filters it in declaration order |
| `enum Visibility { Private = "private", … }` | `CREATE TYPE app.visibility AS ENUM ('private', …)` | the same; prefer the `as const` form, which is erasable — Node's type stripping refuses `enum` |

**Use a union for internal values that change, the enum form for a public vocabulary.** A domain's
values change in one transaction; an enum's order is part of the API, its values can be added but
never removed, and a value added in a transaction cannot be used until it commits.

**What the compiler does at the boundaries.** A domain *is* text, so it meets text anywhere with no
cast. An enum is a type of its own, so wherever TypeScript would use it as a plain string — a
concatenation, a template literal, a `string` parameter, a comparison with a string that is not a
literal — it is cast `::text`, which always succeeds. Going the other way, a value is only ever cast
*to* a domain or an enum where TypeScript has already proven it is one of the set (`"level-2"` passed
as an `AreaType`, a `SmallSize` passed as a `Size`), so that cast cannot fail either. An enum literal
carries its type, `'level-1'::app.area_type`, so it never depends on PostgreSQL guessing one.

**Recognised as written.** The enum form must be exactly `const X = { Name: "value", … } as const`
beside `type X = (typeof X)[keyof typeof X]`, so a reader can see which aliases become enums; a key
that looks like an integer is refused, because JavaScript reorders it in `Object.values`. A numeric
`enum` is refused: at runtime its values are numbers, and TypeScript accepts any number as one. Two sets
that would share a SQL name — even across files — are a build error rather than one silently checking
the other's values.

**Migrations converge, and never destroy.** Neither `CREATE DOMAIN` nor `CREATE TYPE … AS ENUM` has
`IF NOT EXISTS`, so both are guarded:

- **a domain**'s `CHECK` is a constraint the compiler owns, `<name>_values`. When the union changes it
  is dropped and added again — and adding it re-checks every column of the domain, so a value still
  stored somewhere cannot be removed: the migration fails on those rows. An unchanged union touches
  nothing (`pg_get_constraintdef` is compared first).
- **an enum** gains a value added in TypeScript *in its place* (`ADD VALUE … BEFORE` the next existing
  one), so the database order stays the source order. A value removed or the order changed fails the
  migration with what to do: enum values cannot be dropped, and a rename looks the same as a removal
  plus an addition, so `ALTER TYPE … RENAME VALUE` is suggested, never run.

Types are created before everything that uses them: domains and enums, then composites — whose fields
may be either — then functions. A composite's guard compares such a field through `format_type`, like
the catalogue's side, so it does not depend on the search path.

### What `export` asks for

A type a function mentions is created because the function's signature needs it, exported or not. A type
the compiler would otherwise never reach is created because it is **exported**:

```ts
export type Tier = "standard" | "gold";

export interface TodoRow {
  readonly label: string;
  readonly tier: Tier;
}
```

```sql
CREATE DOMAIN app.tier AS text CONSTRAINT tier_values CHECK (VALUE = ANY (ARRAY['gold', 'standard']));
CREATE TYPE app.todo_row AS (label text, tier app.tier);
```

No function here takes a `TodoRow` or returns one, and both types are still created. The reason is that a
composite, a domain or an enum is useful on its own: the column it types lives in a table, written in SQL
the compiler never sees. Requiring a dummy function to bring a type into the schema would be a
workaround for nothing, and would put a function in the schema nobody wanted.

So `export` is the author's statement that a type belongs to the schema, and it is the only thing
`export` means for a type — a non-exported type still compiles wherever a function uses it, and is
still absent from the migration when nothing does. The rule reads the same both ways: **what the
functions need, plus what the file exports.**

Two consequences worth knowing:

- An exported type must be mappable, even if nothing uses it. In a project of compiled functions that is
  the point — these files hold the subset and nothing else — but it does mean `export type Handler = (x:
  number) => void` beside them is a build error rather than ignored. Stop exporting it, or move it out of
  the compiled files.
- An exported alias with no SQL type of its own leaves nothing behind: `export type Name = string` is
  `text`, and `text` needs no `CREATE`. Only composites, domains and enums are objects in the schema.

A **generic** declaration is refused. `Box<T>` is a family of shapes, and a PostgreSQL type is one fixed
column list; there is no honest `CREATE TYPE app.box`. Export the instantiations you need as named types
of their own.

## Arrays

A `readonly T[]` parameter or object field — also written `ReadonlyArray<T>`, or through an alias — is
a PostgreSQL array of the element type, and the element keeps the alias its author wrote: `readonly Integer[]` is
`integer[]`, `readonly TodoItem[]` is `app.todo_item[]`. Three things read one:

| TypeScript | PostgreSQL | Why this form |
| --- | --- | --- |
| `for (const todo of todos)` | `FOREACH todo IN ARRAY todos LOOP` | evaluates the array once and visits it in order, as `for … of` does; `break` and `continue` are `EXIT` and `CONTINUE` |
| `todos.length` | `cardinality(todos)` | `array_length(todos, 1)` is NULL for an empty array, not 0 |
| `plans.includes(plan)` | `array_position(plans, plan) IS NOT NULL` | `= ANY(plans)` is NULL, not false, when the array holds a NULL; `array_position` compares with `IS NOT DISTINCT FROM`, so `includes(null)` works too |

The loop variable is a local of the element type, so an object's fields read as they would on a
parameter (`todo.done` is `(todo).done`), destructuring included. An array can be passed on to another
compiled function, and held in a `const` or `let`.

```ts
export interface TodoItem {
  readonly title: string;
  readonly done: boolean;
}

export function openTodoCount(todos: readonly TodoItem[]): Integer {
  let remaining = 0;
  for (const todo of todos) {
    if (!todo.done) remaining++;
  }
  return remaining;
}
```

From SQL, the array is usually gathered from a table and cast to the composite, row by row:

```sql
SELECT app.open_todo_count(ARRAY(
  SELECT ROW(t.title, t.done)::app.todo_item FROM todos t WHERE t.user_id = 42
));
```

`ARRAY(SELECT …)` rather than `array_agg`: over no rows, `array_agg` is NULL, not an empty array, and
`FOREACH` raises on NULL. `COALESCE(array_agg(…), '{}')` works too.

### Building and returning arrays

An array literal is built from its parts: runs of elements become `ARRAY[…]::t[]`, spreads stay
arrays, and the parts are concatenated with `||`. Concatenation copies, in both languages, so
`[...pending, chore]` is a new array and `pending` is unchanged — which is how `filter` and `map` are
written: a loop over a `let`.

```ts
export function pendingChores(chores: readonly Chore[]): readonly Chore[] {
  let pending: readonly Chore[] = [];
  for (const chore of chores) {
    if (!chore.done) {
      pending = [...pending, chore];
    }
  }
  return pending;
}
```

```sql
pending := ARRAY[]::app.chore[];
FOREACH chore IN ARRAY chores LOOP
  IF NOT (chore).done THEN
    pending := pending || ARRAY[chore]::app.chore[];
  END IF;
END LOOP;
RETURN pending;
```

- **The element type comes from the position** — an annotation, the return type, a parameter, an
  object field — so `[]` is typed and, in `readonly Integer[]`, a `1` stays an `integer`. With no
  position, it comes from the elements: `const pair = [low, high]` is an `integer[]`.
- **Every run is cast** (`ARRAY[x]::integer[]`), because `ARRAY[]` alone has no type, and `ARRAY[1]`
  would not say `double precision[]` when that is what was declared.
- **Numeric elements widen, never narrow.** A `readonly Integer[]` passed or spread where a `readonly
  number[]` is expected is cast, `amounts::double precision[]`; the other way is refused, as for numbers.
- **A returned array** is `RETURNS t[]`, and reads like any other: `pendingChores(chores).length` is
  `cardinality(app.pending_chores(chores))`.

`null` takes the type its position expects too, so `return null` in a function returning `string |
null` is `RETURN NULL`, and `[null]` in a `readonly (string | null)[]` is `ARRAY[NULL]::text[]`.

### Arrays in object types

An array field is one column of array type, like any other field.

```ts
export interface BasketLine {
  readonly sku: string;
  readonly quantity: Integer;
}

export interface Customer {
  readonly tier: "standard" | "gold";
}

export interface Basket {
  readonly customer: Customer;
  readonly lines: readonly BasketLine[];
}
```

```sql
CREATE TYPE app.basket_line AS (sku text, quantity integer);
CREATE TYPE app.customer AS (tier text);
CREATE TYPE app.basket AS (customer app.customer, lines app.basket_line[]);
```

`basket.lines` reads as an array wherever one is expected — `for (const line of basket.lines)` is
`FOREACH line IN ARRAY (basket).lines` — and a spread carries it into a new value:
`{ ...basket, customer: { tier: "gold" } }` is `ROW(ROW('gold')::app.customer, (basket).lines)::app.basket`.

Two consequences for the migration:

- **Types are created in dependency order**, not only by name: `app.basket` needs `app.basket_line`
  and `app.customer` to exist first. A shape that contains itself through an array (`Category { children: readonly
  Category[] }`) is refused: PostgreSQL cannot declare a composite holding an array of itself.
- **The type guard compares that column through `format_type`.** The catalogue writes a type from
  another schema qualified or not depending on the search path, so the expected side is computed the
  same way: `'lines ' || format_type(to_regtype('app.basket_line[]'), NULL)`.

From SQL, a basket is built with a nested `ARRAY(SELECT …)`:

```sql
SELECT app.basket_total(ROW(
  ROW(c.tier)::app.customer,
  ARRAY(SELECT ROW(l.sku, l.quantity)::app.basket_line FROM basket_lines l WHERE l.basket_id = b.id)
)::app.basket)
FROM baskets b JOIN customers c ON c.id = b.customer_id;
```

An array is passed by value, which suits tens or hundreds of elements; over millions of rows, a SQL
aggregate is the right tool.

What lowering refuses, and why:

- **A mutable `T[]`.** PL/pgSQL passes an array by value, so a `push` would change the caller's array
  in TypeScript and a copy in SQL — the same reason field mutation is refused. Requiring `readonly`
  makes TypeScript reject the mutation itself.
- **`xs[i]`.** Out of range, TypeScript gives `undefined` and PostgreSQL NULL; a PostgreSQL array need
  not start at 1; and a fractional index is rounded rather than missing.
- **`includes` on objects**, and `===` on arrays: identity in TypeScript, value in SQL.
- **`includes` that would narrow**: looking for a `number` in `readonly Integer[]` would cast `2.5` to
  `2` and find it.
- **Other methods** (`some`, `map`, `filter`, `reduce`): they take a callback, and PL/pgSQL has no
  closures. Write the loop.
- **A nullable array**, parameter or field: `FOREACH` raises on NULL and `cardinality(NULL)` is NULL; an
  empty array already means "nothing". Elements may be nullable — `readonly (string | null)[]` — except objects, whose NULL
  is indistinguishable from a row of NULL fields.
- **Arrays of arrays, and tuples**: a PostgreSQL array is one rectangular multi-dimensional value, with
  one element type and no fixed length.
- **A shape that contains itself through an array**: no fixed depth, and PostgreSQL cannot declare it.
- **An array literal with a hole** (`[1, , 2]`): the hole is `undefined`, which SQL lacks.
- **`[]` with no type to take**: `ARRAY[]` has no type in PostgreSQL, so an empty literal needs an
  annotation, a return type, a parameter or an object field to stand in.

The SQL side cannot stop a caller passing what TypeScript would not — a NULL element in an
`integer[]`, or a two-dimensional array, which `FOREACH` walks element by element and `cardinality`
counts in full. That is the same contract as a NULL passed for a non-nullable parameter.

## Rejected at build time

Each of these is a case in `tests/rejected/`, one file per case. Each file opens with a comment explaining the refusal, often with the SQL that would have diverged, and the message the compiler must give; `tests/rejected.test.ts` runs them all.

**Language constructs:**

| Rejected | Why |
| --- | --- |
| `if (name)` | truthiness has no faithful SQL translation — compare explicitly |
| `var` | hoisted and function-scoped: use `const`, or `let` for a value that changes |
| `do … while`, `for … in`, `for … of` over a string, labelled `break`/`continue` | write a `while`; a composite has no keys to iterate; SQL has no loop over code points |
| `switch` without `default` | a `CASE` that matches nothing raises, and PostgreSQL does not enforce a union's values |
| `switch` fallthrough | a non-empty clause running into the next has no `CASE` equivalent — end it with `break` or `return` |
| `break` anywhere but the end of a `switch` clause | it would need control flow a `CASE` branch does not model |
| reassigning a parameter; an assignment used as a value; `??=`, `\|\|=`, `&&=`, `**=` | copy the parameter into a `let`; assign on a line of its own; write logical assignments out |
| a fraction assigned to an integer `let` | a `let` takes the type of its initial value; PostgreSQL would round, so annotate it wider |
| `n + 1;` as a statement | a discarded value has no effect in a compiled function |
| `a < b` on text | ordering would follow the database collation, not TypeScript's UTF-16 order |
| a fractional or nullable value in a template literal, a tagged template | the two languages print fractions differently; `\|\| NULL` is NULL where TypeScript writes `null`; a tag is a function call |
| `%` on `double precision` | the operator does not exist for `float8` in PostgreSQL |
| `+`, `-`, `*` or unary `-` yielding an `integer`, outside `int(...)` | PostgreSQL raises past 32 bits where TypeScript does not; see [The `int` guard](#the-int-guard) |
| `+=`, `-=`, `*=`, `++`, `--` on an `integer` | a statement has nowhere to put the guard; write `x = int(x + y)` |
| `int(...)` around a `double precision` expression | the guard leaves no cast behind, so PostgreSQL would round where TypeScript raised |
| a whole literal outside 32 bits where an `Integer` is wanted | PostgreSQL has no `integer` that wide; declare it a `Float` |
| optional parameters | absence must be explicit: write `T \| null` |
| `T \| undefined` | SQL models absence one way only — use `null` |
| a `number` where `Integer` is expected | PostgreSQL rounds a `double precision` stored into an `integer` silently; numbers may only widen (`integer` → `double precision`) |
| inferred return types | the signature is part of the contract, so it must be written down — for arrow functions too |
| destructuring defaults, `...rest`, array destructuring | a default applies on `undefined`, which SQL lacks; a rest object has no named type; reading by position is outside the subset |
| a mutable `T[]`, `xs[i]`, array methods but `includes`, `===` on arrays | see [Arrays](#arrays) |
| a nullable array, arrays of arrays, tuples, a shape recursive through an array, holes, an untyped `[]` | see [Arrays](#arrays) |
| `export let f = () => …`, `function` expressions | a `let` binding can be reassigned; write a `function` declaration or a `const` arrow function |
| `==` / `!=` | no SQL equivalent for loose equality |
| a numeric `enum`; the enum form without `as const` or with an integer-like key; two named sets with one SQL name | see [Named types](#named-types-domains-and-enums) |
| generics, `Date` | outside the subset whose semantics can be preserved |
| an exported generic type, `export interface Box<T>` | an exported type is created in the schema, and a PostgreSQL type is one fixed column list |
| `{ plan: string }` inline | anonymous: give the shape a name so the composite type has one |
| `note?: string` on an object | a composite field is always present — write `T \| null` |
| an anonymous nested shape, `{ foo: { bar: string } }` | a composite column needs a named type: give the shape a name |
| a nested object that may be null | `IS NULL` cannot tell a NULL composite from a row of NULL fields |
| a shape that contains itself | no fixed depth; PostgreSQL refuses it too |
| two fields that are the same column | `fooBar` and `foo_bar` are both `foo_bar` |
| `nested.foo.bar = "x"` | TypeScript mutates the caller's object; PL/pgSQL mutates a copy |
| `===` on two objects | identity in TypeScript, value in SQL |
| an unannotated object literal | `ROW()` must be cast to a nominal type, so a target type is required |
| an index signature | no fixed composite shape |

**Runtime references.** A compiled function may use its parameters, its local constants, and other compiled functions — nothing else:

| Rejected | Reported as |
| --- | --- |
| `Math.PI`, `JSON.stringify(x)`, `Number.isInteger(n)` | `` `Math.PI` is a JavaScript runtime global and has no PL/pgSQL equivalent `` |
| `Math.round(x)`, `Math.sin(x)`, `Math.random()`, `Math.max(...xs)` | `` `Math.round` is not supported: … Supported: Math.abs, Math.ceil, … `` — the reason, and the members that do compile (see [Math](#math)) |
| `new Date().getTime()` | `` `Date` is a JavaScript runtime global … `` |
| `Infinity`, `NaN`, `undefined`, `globalThis` | the specific alternative, e.g. `` PostgreSQL spells it `'Infinity'::double precision` `` |
| `fc.sample(…)` from an imported package | `` `fc` comes from a package (`fast-check`), which cannot run inside PostgreSQL `` |
| `plan.length`, `plan.toUpperCase()`, `plan[0]` | the reason the SQL that looks right is not the same function, and the methods that do compile — `` `.length` on a string is not supported: TypeScript counts UTF-16 code units … Supported: .trim(), .trimEnd(), .trimStart() `` (see [Strings](#strings)). Methods on anything but a string, and element access, are not in the subset |
| `async` / `await` | `` a PL/pgSQL function runs to completion with nothing to await `` |
| calling a function that is not exported | `` `double` is not exported, so it is not compiled `` — only exported functions become functions in the schema |
| calling a function exported from a file this build does not include | `` `double` is exported from `helpers.ts`, which this build does not include `` — a migration is written from exactly the files named, so the call would reach a function it does not create |
| a module-level value, `const rate = 0.2` read from a function | `` `rate` is a value declared outside the function `` — inlining it would freeze a copy in the database that the TypeScript could later change, and the parity harness would keep agreeing because it imports the same module |

This is decided by **provenance, not by name**: `src/references.ts` resolves the symbol and asks the program whether its declaration file `isDefaultLibrary` or `isFromExternalLibrary`. A symbol declared in the project is then split by whether it is *callable* — a non-compiled function is told to be exported, a value is told to become a parameter — asked of its type, so a `function` declaration and a `const` bound to an arrow answer alike. So every standard-library global is covered without maintaining a denylist, anything the library grows is covered for free, and a parameter that happens to be *named* `Math` still compiles (`tests/parity/shadowedGlobal.ts`). The one exception to "no list of names" runs the other way: [the members of `Math` that do compile](#math) are a closed table, as are those of `Number` and [the three methods of `String.prototype`](#strings), and `Math` itself is still found by provenance (`tests/rejected/mathLookalike.ts`).

Node and Bun globals (`process`, `Bun`, `require`) are blocked one layer earlier: tsql always type checks with `"types": []` and `lib: ["ESNext"]`, whatever a tsconfig says, so they are type errors before the translator runs. It imposes `strict` the same way: without `strictNullChecks`, TypeScript lets `null` into every type, and a nullable comparison would lower to `=` instead of `IS NOT DISTINCT FROM`.

Rejections carry a file, line, column and the offending source line.

## Parity tests

This section is the *how*; [Parity](../README.md#parity) in the README is the *what*. `tsql parity` (`src/runParity.ts`) opens the database and reports; the check itself is `src/parity.ts`, which this repo's own `tests/parity.test.ts` also drives. The harness is internal — it is not exported from the package.

`src/parity.ts` reads the manifest the compiler emits, derives a fast-check generator per parameter from its PostgreSQL type — an object for a composite parameter, which it flattens into `ROW($1::text)::app.subscription` on the SQL side — and runs 200 random inputs per function through both implementations: the TypeScript function imported directly, and the generated function in PGlite. Adding a function adds a parity test with no edit to the test file.

The harness takes a `RowQuery` callback, so it does not care which PostgreSQL it talks to — which is how `tsql parity` swaps PGlite for a real server under `--db-url`.

`tests/parity.test.ts` runs the harness on every case in `tests/parity/`, through the same `openDatabase` the command uses: on PGlite always, and on a real PostgreSQL when `TSQL_TEST_DB_URL` names one (CI provides a PostgreSQL 18 service), inside the same rolled-back transaction as `--db-url`. The failure message shown in the README is itself a test: `tests/divergent/` holds hand-written TypeScript/SQL pairs that disagree — a wrong result, a TypeScript function that mutates its argument — and `tests/divergent.test.ts` asserts the harness catches each one on both backends, so the suite cannot pass vacuously.

Two further checks:

- **Composite returns** are compared field by field, selecting `(result).field` so each field arrives as a typed column. That avoids parsing PostgreSQL's composite text format, where `""`, NULL and the literal string `"null"` are three different values with three confusingly similar encodings. An array or nested-object field is selected as `to_jsonb(…)` for the same reason: a composite inside a composite, in text form, is quoting nested inside quoting.
- **Arguments are snapshotted** before the TypeScript function runs and compared afterwards. A function that mutates what it was given has an effect its SQL twin cannot reproduce, and comparing return values alone would never notice.

## Keeping `Integer` honest once installed

`Integer`, `Float` and `int` are resolved by name, so the compiler has to be sure the name it found is *its* name. That check asks which npm package declared the symbol — walking up to the nearest `package.json` — rather than matching the path:

```ts
// a consumer's own src/index.ts
export type Integer = string;
```

A path-suffix check accepts that file, because it does end in `src/index.ts`, and `Integer` would compile to PostgreSQL's `integer` while TypeScript was holding a string. Asking the package name rejects it and maps it to `text`, which is what it is. `PACKAGE_NAME` in `src/authoring.ts` is held equal to package.json's `name` by a test.

## The CLI's own refusals

An option another command owns is refused rather than ignored — `tsql check … --runs 5` is an error,
not a check that quietly ran no tests. The CLI is built on [commander](https://github.com/tj/commander.js),
so the help is generated from the same declarations that parse the arguments and cannot drift from them.

Files are named explicitly, and an invocation with no files prints usage and exits non-zero. There is no "compile everything" default on purpose: the migration is written from exactly the files given, so a default would let `tsql compile` quietly write more than was asked for over whatever was there before. By the same token, narrowing to a subset writes a migration holding only that subset — pass the glob when you mean the whole project.

A file the project does not hold is an error listing what it does hold, rather than a build that reports success having translated nothing. All three commands exit non-zero on a rejection; `parity` also exits non-zero when any function diverges from its TypeScript.
