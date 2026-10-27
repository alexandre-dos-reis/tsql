/**
 * Rejected: looking for a wider number in an array of narrower ones.
 *
 * TypeScript compares doubles: `[2].includes(2.5)` is false. PostgreSQL needs
 * both sides of `array_position` to have one type, and casting 2.5 to an
 * `integer` rounds it to 2 — which is found:
 *
 *     SELECT array_position(ARRAY[2], 2.5::integer);  -- 1
 *
 * Declare the elements as wide as the value (`readonly number[]`).
 *
 * Expected: would need a cast that rounds it
 */
import type { Integer } from "../../src/index";

export function hasSeats(seats: readonly Integer[], wanted: number): boolean {
  return seats.includes(wanted); // ← rejected here
}
