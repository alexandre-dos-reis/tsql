/**
 * Divergent: the SQL returns a different value from the TypeScript.
 *
 * The TypeScript says the free plan allows 3 todos; the hand-written SQL beside
 * it (wrongResult.sql) says 4. The compiler would never emit this — which is why
 * it is written by hand: the point is to prove the parity harness notices when
 * the two implementations disagree, on at least one generated input. A harness
 * that could not fail would make every green parity run meaningless.
 */
import type { ManifestFunction } from "../../src/compile.ts";

export function todoLimit(plan: "free" | "pro"): number {
  return plan === "free" ? 3 : 1000;
}

/** How the harness calls the SQL side: the signature the compiler would have recorded. */
export const signature: ManifestFunction = {
  tsName: "todoLimit",
  sqlName: "wrong_limit",
  module: "tests/divergent/wrongResult.ts",
  params: [
    { tsName: "plan", sqlName: "plan", type: { kind: "scalar", sql: "text", nullable: false, allowed: ["free", "pro"] } },
  ],
  returns: { kind: "scalar", sql: "integer", nullable: false },
};

/** What the harness must report. */
export const expected = 'todoLimit("free") diverges: TypeScript gave 3, PostgreSQL gave 4';
