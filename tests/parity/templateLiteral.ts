import type { Integer } from "../../src/pgtypes";

/**
 * Template literals are `||` concatenation. Text goes in as is; `Integer` and `boolean` are written
 * with `::text`, which gives the same characters as `String(value)`. Empty pieces are dropped, a
 * template without substitutions is a plain literal, and quotes in the pieces are escaped as in any
 * string literal.
 */

export function planLabel(plan: "free" | "pro", region: string): string {
  return `${plan}-${region}`;
}

export function seatsLabel(seats: Integer, annual: boolean): string {
  return `${seats} seats (annual: ${annual})`;
}

export function quotedName(name: string): string {
  return `"${name}" isn't empty`;
}

export function helloOrNobody(name: string): string {
  return name === "" ? `nobody` : `hello ${name}`;
}

export function sumLabel(a: Integer, b: Integer): string {
  return `${a + b}/${a * 2}`;
}

export function ownerLabel(owner: string | null): string {
  return `owner: ${owner ?? "none"}`;
}
