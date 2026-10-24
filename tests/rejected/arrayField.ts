/**
 * Rejected: an array as a field of an object type.
 *
 * Flattening turns each field into one column of the composite; an array
 * field would be a column of array type inside a composite inside, possibly,
 * another array. That is representable, but not yet part of the subset.
 *
 * Expected: `Order.lines` is an array
 * Expected: not yet as fields of an object type
 */
interface Order {
  readonly lines: readonly number[];
}

export function lineCount(order: Order): number {
  return order.lines.length;
}
