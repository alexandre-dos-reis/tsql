/**
 * Rejected: an optional parameter (`name?: string`).
 *
 * A SQL function call always supplies every argument; absence has to be explicit.
 * Write `name: string | null`, which compiles to a nullable parameter with
 * explicit null checks.
 */
export function greet(name?: string): boolean {
  return name !== undefined;
}
