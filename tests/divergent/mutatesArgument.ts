/**
 * Divergent: the TypeScript mutates its argument; the SQL cannot.
 *
 * Both sides return the same value — a seat with one more count — so comparing
 * return values alone would pass. But the TypeScript also changes the caller's
 * object, and PL/pgSQL passes composites by value, so the SQL function in
 * mutatesArgument.sql can never reproduce that effect. The harness snapshots
 * the arguments before the TypeScript call and compares them afterwards; this
 * case proves that check fires.
 *
 * The compiler refuses this TypeScript outright (tests/rejected/mutateField.ts),
 * so the pair has to be written by hand.
 */
import type { ManifestFunction } from "../../src/compile.ts";

export function grantSeat(seat: { plan: string; count: number }): { plan: string; count: number } {
  seat.count = seat.count + 1;
  return seat;
}

const seatType = {
  kind: "composite",
  tsName: "DivergentSeat",
  sqlName: "divergent_seat",
  fields: [
    { tsName: "plan", sqlName: "plan", type: { kind: "scalar", sql: "text", nullable: false, allowed: ["free", "pro"] } },
    { tsName: "count", sqlName: "count", type: { kind: "scalar", sql: "double precision", nullable: false } },
  ],
  nullable: false,
} as const;

/** How the harness calls the SQL side: the signature the compiler would have recorded. */
export const signature: ManifestFunction = {
  tsName: "grantSeat",
  sqlName: "divergent_grant_seat",
  module: "tests/divergent/mutatesArgument.ts",
  params: [{ tsName: "seat", sqlName: "seat", type: seatType }],
  returns: seatType,
};

/** What the harness must report. */
export const expected = "the TypeScript function mutated its arguments";
