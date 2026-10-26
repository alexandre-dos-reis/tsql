/**
 * Rejected: reading a value declared outside the function.
 *
 * `foo` lives in the module, and a PL/pgSQL function sees nothing but its own
 * parameters and declarations. Inlining the value is the guess, and it is the
 * dangerous one: the migration would hold `RETURN 'bar'`, frozen at the moment
 * it was compiled, while the TypeScript is free to change — and the parity
 * harness would keep agreeing, because it imports the same module the compiler
 * read. The same silent drift as a mutated field, by a different route.
 *
 * The rule the message states is the whole surface a compiled function has:
 * its parameters, its local constants, and the other compiled functions.
 *
 * Expected: `foo` is a value declared outside the function.
 * Expected: A compiled function may only use its parameters, its local constants, and other compiled functions.
 * Expected: Pass it as a parameter, or declare it inside the function.
 */

export const foo: string = "bar";

export function impure(): string {
  return foo; // ← rejected here
}
