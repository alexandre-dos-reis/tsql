/**
 * Rejected: `Math.PI`, a JavaScript runtime global.
 *
 * Nothing from the JavaScript runtime exists inside PostgreSQL. (`pi()` exists,
 * but globals are refused as a class rather than mapped one by one.) Write the
 * constant out, or pass it as a parameter.
 */
export function isBigger(n: number): boolean {
  return n > Math.PI;
}
