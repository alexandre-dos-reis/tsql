export type Point = { x: number };

export function same(p: Point, q: Point): boolean {
  switch (p) {
    case q:
      return true;
  }
  return false;
}
