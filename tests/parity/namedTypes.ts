import { int, type Integer } from "../../src/index";

/**
 * Named closed sets of strings become types of their own. A union alias is a domain over `text`:
 * structural, like the union, so it needs no cast to meet text, and one union passed where a wider one
 * is expected is cast to it. An `as const` object with its `(typeof X)[keyof typeof X]` alias, or a
 * string `enum`, is a PostgreSQL enum in the order written; its literals carry their type, and it is
 * cast to `text` wherever TypeScript would use it as a plain string — a concatenation, a `string`
 * parameter. Domains and enums are created before the composites whose fields use them.
 */

export const AreaType = {
  Level1: "level-1",
  Level2: "level-2",
  Level3: "level-3",
} as const;
export type AreaType = (typeof AreaType)[keyof typeof AreaType];

export enum Visibility {
  Private = "private",
  Team = "team",
  Public = "public",
}

export type Zone = "north" | "south";
export type Size = "s" | "m" | "l";
export type SmallSize = "s" | "m";

export interface Parcel {
  readonly area: AreaType;
  readonly zone: Zone;
}

export function areaDepth(area: AreaType): Integer {
  switch (area) {
    case AreaType.Level1:
      return 1;
    case AreaType.Level2:
      return 2;
    default:
      return 3;
  }
}

export function deeper(area: AreaType): AreaType {
  return area === AreaType.Level3 ? AreaType.Level3 : area === AreaType.Level2 ? AreaType.Level3 : AreaType.Level2;
}

export function depthOfLevel2(bonus: Integer): Integer {
  return int(areaDepth("level-2") + bonus);
}

export function areaLabel(area: AreaType, zone: Zone): string {
  return area + "/" + zone;
}

export function areaTag(area: AreaType, zone: Zone): string {
  return `${area}${area === AreaType.Level1 ? "!" : ""}:${zone}`;
}

export function shout(message: string): string {
  return message + "!";
}

export function areaShout(area: AreaType): string {
  return shout(area);
}

export function isDeepArea(areas: readonly AreaType[], area: AreaType): boolean {
  return areas.includes(area);
}

export function moveDeeper(parcel: Parcel): Parcel {
  return { ...parcel, area: deeper(parcel.area) };
}

export function visibleTo(visibility: Visibility, isMember: boolean): boolean {
  if (visibility === Visibility.Public) {
    return true;
  }
  return visibility === Visibility.Team && isMember;
}

export function sizeRank(size: Size): Integer {
  return size === "s" ? 1 : size === "m" ? 2 : 3;
}

export function smallRank(size: SmallSize): Integer {
  return sizeRank(size);
}
