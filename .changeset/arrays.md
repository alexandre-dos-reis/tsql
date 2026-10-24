---
"@adr/tsql": minor
---

Compile read-only array parameters. `readonly T[]` (also `ReadonlyArray<T>`, or through an alias) is a PostgreSQL `T[]` of scalars, nullable scalars or a named object type, keeping `Integer` as `integer[]`. `for (const x of xs)` compiles to `FOREACH`, with `break` and `continue`; `xs.length` to `cardinality(xs)`; `xs.includes(x)` on scalars to `array_position(xs, x) IS NOT NULL`, which finds a NULL as `includes(null)` does. Refused with an explanation: mutable `T[]` (arrays are passed by value), `xs[i]`, other array methods, `includes` on objects or that would round its argument, `===` on arrays, nullable arrays, arrays of arrays, tuples, and array fields, locals and returns. The parity harness generates arrays of up to 10 elements.
