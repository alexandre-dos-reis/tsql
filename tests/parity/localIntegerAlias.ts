/**
 * `Integer` here is this file's own alias, not tsql's: it must map to the `number` it is, never to
 * `integer`.
 *
 * Expected SQL: weight double precision
 * Expected SQL: RETURNS double precision
 */
type Integer = number;

export function doubledWeight(weight: Integer): Integer {
  return weight * 2;
}
