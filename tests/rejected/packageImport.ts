import fc from "fast-check";

export function sampleSize(n: number): number {
  return fc.sample(fc.integer(), n).length;
}
