import { int, type Integer } from "../../src/index";

/**
 * `readonly T[]` parameters, in the three ways an array type can be written — `readonly Integer[]`,
 * `ReadonlyArray<Integer>` and an alias — all of which keep `Integer` as `integer[]`. `.length` is
 * `cardinality`, which is 0 for an empty array where `array_length` would be NULL. `for … of` is
 * `FOREACH`, with `break` and `continue`. `includes` is `array_position(…) IS NOT NULL`, which finds
 * a NULL as `includes(null)` does, and widens the value to the elements' type rather than narrowing.
 */

type Offer = "free" | "pro" | "team";
type Quantities = readonly Integer[];

export function itemCount(items: readonly Integer[]): Integer {
  return items.length;
}

export function sumUntilNegative(amounts: ReadonlyArray<Integer>): Integer {
  let total = 0;
  for (const amount of amounts) {
    if (amount < 0) {
      break;
    }
    if (amount % 2 === 0) {
      continue;
    }
    total = int(total + amount);
  }
  return total;
}

export function largestQuantity(quantities: Quantities): Integer {
  let largest = 0;
  for (const quantity of quantities) {
    if (quantity > largest) {
      largest = quantity;
    }
  }
  return largest;
}

export function offersPlan(plans: readonly Offer[], plan: Offer): boolean {
  return plans.includes(plan);
}

export function hasScore(scores: readonly number[], score: Integer): boolean {
  return scores.includes(score);
}

export function hasMissingNote(notes: readonly (string | null)[]): boolean {
  return notes.includes(null);
}

export function countMissingNotes(notes: readonly (string | null)[]): Integer {
  let missing = 0;
  for (const note of notes) {
    if (note === null) {
      missing = int(missing + 1);
    }
  }
  return missing;
}
