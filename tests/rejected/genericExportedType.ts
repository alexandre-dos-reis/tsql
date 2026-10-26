/**
 * Rejected: a generic exported type.
 *
 * An exported type is created in the schema, and a PostgreSQL type is one fixed
 * shape. `Box<T>` is a family of shapes with no column list to create — there
 * is no honest `CREATE TYPE app.box`.
 *
 * Expected: `Box` is generic, so it has no one shape.
 */

export interface Box<T> { // ← rejected here
  readonly value: T;
}
