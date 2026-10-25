/**
 * Rejected: the enum form without `as const`.
 *
 * Without `as const` the object's values are plain `string`s, so
 * `(typeof AreaType)[keyof typeof AreaType]` is `string`: there is no closed set
 * of values to make an enum of, and TypeScript would accept any string.
 *
 * Expected: must be declared as `const AreaType = { … } as const`
 */
const AreaType = {
  Level1: "level-1",
  Level2: "level-2",
};
type AreaType = (typeof AreaType)[keyof typeof AreaType];

export function isTop(area: AreaType): boolean {
  return area === "level-1";
}
