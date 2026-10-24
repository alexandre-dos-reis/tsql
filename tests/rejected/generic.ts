/**
 * Rejected: a generic function.
 *
 * A PL/pgSQL function has concrete parameter and return types; there is no `T`.
 * (`anyelement` exists, but its semantics are not TypeScript's.) Write one
 * function per concrete type.
 *
 * Expected: Generic functions are not supported
 */
export function identity<T>(value: T): T {
  return value;
}
