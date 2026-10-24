/**
 * Rejected: an anonymous object type as a parameter.
 *
 * A TypeScript object type becomes a PostgreSQL composite type, and composite
 * types are nominal: `CREATE TYPE app.<name> AS (...)` needs a name. An inline
 * `{ plan: string }` has none to generate. Name the shape (`type Sub = { plan:
 * string }`) and it compiles to `CREATE TYPE app.sub AS (plan text)`.
 *
 * Expected: Anonymous object types are not supported
 */
export function hasPlan(sub: { plan: string }): boolean {
  return sub.plan !== "free";
}
