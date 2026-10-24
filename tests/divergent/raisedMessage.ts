/**
 * Divergent: both sides raise, with different messages.
 *
 * A `throw new Error(m)` compiles to `RAISE EXCEPTION '%', m`, so the harness
 * accepts a raise only when both sides raise the same message. Here the
 * hand-written SQL (raisedMessage.sql) words it differently for "pro" — a
 * caller matching on the message would behave differently — and the harness
 * has to say so.
 */
import type { ManifestFunction } from "../../src/compile.ts";

export function planCheck(plan: "free" | "pro"): number {
  if (plan === "pro") {
    throw new Error("plan is unknown");
  }
  return 1;
}

/** How the harness calls the SQL side: the signature the compiler would have recorded. */
export const signature: ManifestFunction = {
  tsName: "planCheck",
  sqlName: "plan_check",
  module: "tests/divergent/raisedMessage.ts",
  params: [
    { tsName: "plan", sqlName: "plan", type: { kind: "scalar", sql: "text", nullable: false, allowed: ["free", "pro"] } },
  ],
  returns: { kind: "scalar", sql: "integer", nullable: false },
};

/** What the harness must report. */
export const expected = 'planCheck("pro") diverges: TypeScript raised "plan is unknown", PostgreSQL raised "unknown plan"';
