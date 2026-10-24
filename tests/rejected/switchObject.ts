/**
 * Rejected: a `switch` on an object.
 *
 * Labels match with `===`, which compares objects by identity in TypeScript but
 * composites by value in SQL, so `case q:` has no faithful translation. Switch on
 * a field instead.
 */
export type Point = { x: number };

export function same(p: Point, q: Point): boolean {
  switch (p) {
    case q:
      return true;
    default:
      return false;
  }
  return false;
}
