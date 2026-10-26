/**
 * Rejected: calling a function exported from a file this build does not include.
 *
 * `tripleIt` is exported, and would compile. The problem is the *file*: a
 * migration is written from exactly the files named, so emitting
 * `app.triple_it(…)` here would produce a call to a function this migration
 * does not create — it would apply, and then fail at the first call.
 *
 * So the advice is about the files named, not about `export`, which the author
 * has already done. Telling this apart from uncompiledFunction.ts is the whole
 * point: there, `export` is the fix; here, it would be advice already followed.
 *
 * Nothing needs to check whether `tripleIt` is exported, because the build type
 * checks before translating: a name that could be imported was exported.
 *
 * Expected: `tripleIt` is exported from
 * Expected: which this build does not include.
 * Expected: Name that file too, or compile the whole set at once
 */

import { tripleIt } from "./helpers/arith";

export function triple(n: number): number {
  return tripleIt(n); // ← rejected here
}
