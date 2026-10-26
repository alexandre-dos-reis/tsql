/**
 * Rejected: calling a function that is not compiled.
 *
 * `double` is perfectly translatable — it is simply not exported, so it has no
 * `app.double()` for the call to reach. Refusing is the only honest answer:
 * inlining the body would make `app.a()` hold a copy that the TypeScript could
 * later change, and compiling `double` unasked would put a function in the
 * schema nobody exported.
 *
 * The counterpart of moduleValue.ts: both names are declared in the project,
 * and the advice differs because one is callable and the other is not. That is
 * decided from the symbol's type, so `triple` — a `const` bound to an arrow —
 * answers like `double` rather than like a value.
 *
 * Expected: `double` is not a compiled function. Only exported functions in this project can be called.
 * Expected: `triple` is not a compiled function. Only exported functions in this project can be called.
 */

function double(n: number): number {
  return n * 2;
}

const triple = (n: number): number => n * 3;

export function a(n: number): number {
  return double(n); // ← rejected here
}

export function b(n: number): number {
  return triple(n);
}
