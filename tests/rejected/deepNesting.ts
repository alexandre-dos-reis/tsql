/**
 * Rejected: an object type nested more than 4 levels deep.
 *
 * Nested shapes are flattened to prefixed columns (`a.b.c.d.e` → `a_b_c_d_e`).
 * Nesting this deep is more likely a modelling mistake than a business rule,
 * and the column names grow towards PostgreSQL's 63-byte identifier limit.
 * Flatten the shape in TypeScript.
 *
 * Expected: nests more than 4 levels deep
 */
type Deep = {
  a: { b: { c: { d: { e: string } } } };
};

export function deepValue(deep: Deep): string {
  return deep.a.b.c.d.e;
}
