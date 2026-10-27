/**
 * Rejected: a project's own `int`, which is not the guard.
 *
 * The guard is recognised by provenance — which package declared it — not by
 * its name, for the same reason `Integer` is. A local `int` that rounded, or
 * logged, or did nothing would be erased from the SQL if the name alone were
 * enough, and the two implementations would quietly stop matching.
 *
 * So this is just a call to a function that is not compiled.
 *
 * Expected: is not exported, so it is not compiled
 */
import { type Integer } from "../../src/index";

function int(n: number): Integer {
  return Math.trunc(n);
}

export function doubled(a: Integer): Integer {
  return int(a * 2); // ← rejected here
}
