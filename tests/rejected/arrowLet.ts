/**
 * Rejected: an arrow function exported with `let`.
 *
 * A `let` (or `var`) binding can be reassigned, so the function the name refers
 * to is not fixed — the SQL function would be compiled from one value while the
 * TypeScript might call another. Export it with `const`.
 *
 * Expected: Export `double` with `const`
 */
export let double = (n: number): number => n * 2;
