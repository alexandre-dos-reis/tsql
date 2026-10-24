/**
 * Rejected: a fractional number in a template literal.
 *
 * TypeScript writes the number with `String(value)`, PostgreSQL with its own
 * text output, and the two disagree:
 *
 *     TS:  `${0.1 + 0.2}`            -> "0.30000000000000004"
 *     SQL: (0.1 + 0.2)::text         -> '0.3'           (numeric arithmetic)
 *     TS:  `${1e21}`                 -> "1e+21"
 *     SQL: 1e21::double precision::text -> '1e+21', but 1.10::numeric::text -> '1.10'
 *
 * Only text, `Integer` and `boolean` are written the same way in both.
 *
 * Expected: in a template literal is not supported: TypeScript and PostgreSQL write fractional numbers differently
 */
export function priceLabel(price: number): string {
  return `${price} €`; // ← rejected here
}
