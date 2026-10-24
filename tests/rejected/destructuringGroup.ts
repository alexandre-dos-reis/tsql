/**
 * Rejected: destructuring a nested group as a value (`const { shipping } = …`).
 *
 * Nested shapes are flattened into columns (`shipping_country`, …), so
 * `shipping` is not one value but several columns. Destructure it further,
 * `const { shipping: { country } } = purchase`, to read a leaf.
 *
 * Expected: `shipping` is a nested shape, not a value
 */
type Purchase = { quantity: number; shipping: { country: string } };

export function countryOf(purchase: Purchase): string {
  const { shipping } = purchase;
  return shipping.country;
}
