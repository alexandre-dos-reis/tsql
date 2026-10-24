/**
 * Rejected: calling a function imported from a package.
 *
 * Package code is JavaScript that cannot run inside PostgreSQL. Only the exported
 * functions of the rules project itself are compiled and callable.
 */
import fc from "fast-check";

export function sampleSize(n: number): number {
  return fc.sample(fc.integer(), n).length;
}
