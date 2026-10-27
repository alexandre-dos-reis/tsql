import { int, type Integer } from "../../src/index";

/**
 * Building arrays. A literal's runs of elements are `ARRAY[…]::t[]` and its spreads are arrays, joined
 * with `||`, so `[...pending, chore]` copies and appends — `filter` and `map` are a loop over a `let`.
 * The element type comes from the position: `[]` needs one, and in `readonly number[]` an `Integer`
 * element or spread is widened by a cast. Arrays are returned, read off a call (`.length`), and held
 * in an inferred local. `null` takes the expected type, so `return null` and `[null]` compile.
 */

export interface Chore {
  readonly title: string;
  readonly done: boolean;
  readonly minutes: Integer;
}

export function pendingChores(chores: readonly Chore[]): readonly Chore[] {
  let pending: readonly Chore[] = [];
  for (const chore of chores) {
    if (!chore.done) {
      pending = [...pending, chore];
    }
  }
  return pending;
}

export function choreMinutes(chores: readonly Chore[]): readonly Integer[] {
  let minutes: readonly Integer[] = [];
  for (const chore of chores) {
    minutes = [...minutes, chore.minutes];
  }
  return minutes;
}

export function pendingCount(chores: readonly Chore[]): Integer {
  return pendingChores(chores).length;
}

export function withBounds(amounts: readonly Integer[], low: Integer): readonly number[] {
  return [low, ...amounts, 0.5];
}

export function doubledList(amounts: readonly Integer[]): readonly Integer[] {
  return [...amounts, ...amounts];
}

export function nonEmptyOrDefault(tags: readonly string[]): readonly (string | null)[] {
  return tags.length === 0 ? [null] : tags;
}

export const onlyIfBusy = (chores: readonly Chore[], limit: Integer): readonly Chore[] =>
  chores.length > limit % 5 ? chores : [];

export function firstLongChore(chores: readonly Chore[]): string | null {
  for (const chore of chores) {
    if (chore.minutes > 30) {
      return chore.title;
    }
  }
  return null;
}

export function pairTotal(low: Integer, high: Integer): Integer {
  const pair = [low, high];
  let total = 0;
  for (const part of pair) {
    total = int(total + part);
  }
  return total;
}
