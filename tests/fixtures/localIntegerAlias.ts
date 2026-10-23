/**
 * `Integer` here is this file's own alias, not tsql's. It must map to the
 * `number` it actually is, never to PostgreSQL's `integer`.
 */
type Integer = number;

export function shippingCents(weight: Integer): Integer {
  return weight * 2;
}
