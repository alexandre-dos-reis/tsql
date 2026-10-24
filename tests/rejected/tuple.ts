/**
 * Rejected: a tuple.
 *
 * A tuple has a fixed length and a type per position; a PostgreSQL array has
 * neither. A named object type says the same thing with names, and maps to a
 * composite.
 *
 * Expected: Tuples are not supported
 */
export function width(size: readonly [number, number]): number { // ← rejected here
  return size.length;
}
