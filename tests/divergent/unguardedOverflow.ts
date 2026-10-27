/**
 * Divergent: PostgreSQL raises on `integer` overflow where the TypeScript does not.
 *
 * The hand-written SQL beside this file multiplies two `integer`s, which
 * PostgreSQL refuses past 32 bits; the TypeScript multiplies two doubles and
 * returns 10000000000 quite happily. One side raising where the other returns
 * is a divergence, and the harness has to say so.
 *
 * This is the negative control for the guard: `checkParity` treats *both* sides
 * raising as agreement, which is what makes `int(...)` worth writing. This case
 * proves that allowance did not turn into "any exception passes".
 *
 * The compiler refuses this TypeScript outright
 * (tests/rejected/integerOverflow.ts), so the pair is written by hand.
 */
import type { ManifestFunction } from "../../src/compile.ts";

export function seatTotal(seats: number, unitCents: number): number {
  return seats * unitCents;
}

/** How the harness calls the SQL side: the signature the compiler would have recorded. */
export const signature: ManifestFunction = {
  tsName: "seatTotal",
  sqlName: "divergent_seat_total",
  module: "tests/divergent/unguardedOverflow.ts",
  params: [
    { tsName: "seats", sqlName: "seats", type: { kind: "scalar", sql: "integer", nullable: false } },
    { tsName: "unitCents", sqlName: "unit_cents", type: { kind: "scalar", sql: "integer", nullable: false } },
  ],
  returns: { kind: "scalar", sql: "integer", nullable: false },
};

/** What the harness must report. The error text itself differs between backends. */
export const expected = "the TypeScript has to raise too";
