/**
 * Rejected: calling a function that is not compiled.
 *
 * `double` is perfectly translatable — it is simply not exported, so it has no
 * `app.double()` for the call to reach. Refusing is the only honest answer:
 * inlining the body would make `app.a()` hold a copy that the TypeScript could
 * later change, and compiling `double` unasked would put a function in the
 * schema nobody exported.
 *
 * Its own counterpart is excludedFunction.ts, where the function *is* exported
 * and the file it lives in was simply left out of the build — the advice there
 * is about the files named, not about `export`.
 *
 * The counterpart of moduleValue.ts: both names are declared in the project,
 * and the advice differs because one is callable and the other is not. That is
 * decided from the symbol's type, so `triple` — a `const` bound to an arrow —
 * answers like `double` rather than like a value.
 *
 * Expected: `double` is not exported, so it is not compiled.
 * Expected: `triple` is not exported, so it is not compiled.
 * Expected: Only exported functions become functions in the schema, and only those can be called.
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
