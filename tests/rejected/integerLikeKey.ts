/**
 * Rejected: an integer-like key in the enum object.
 *
 * JavaScript moves integer-like keys to the front: `Object.values` of
 * `{ Low: "low", "1": "one" }` is `["one", "low"]`. The PostgreSQL enum is made
 * in the order written, so the two orders would differ.
 *
 * Expected: an integer-like key is reordered by JavaScript
 */
const Rank = {
  Low: "low",
  "1": "one", // ← rejected here
} as const;
type Rank = (typeof Rank)[keyof typeof Rank];

export function isLow(rank: Rank): boolean {
  return rank === Rank.Low;
}
