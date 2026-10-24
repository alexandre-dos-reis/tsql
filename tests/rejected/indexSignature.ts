/**
 * Rejected: an object type with an index signature.
 *
 * A composite type has a fixed, named list of columns; `{ [key: string]: string }`
 * has an open set of keys, so there is no column list to generate.
 *
 * Expected: `Bag` has an index signature
 */
interface Bag {
  [key: string]: string;
}

export function isEmptyBag(bag: Bag): boolean {
  return bag !== null;
}
