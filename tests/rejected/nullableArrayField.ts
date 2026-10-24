/**
 * Rejected: an array field that may be null.
 *
 * As for a parameter: `FOREACH` raises on a NULL array where an empty one
 * loops zero times, and `cardinality(NULL)` is NULL rather than a number. An
 * empty array already says "nothing".
 *
 * Expected: cannot appear in a union: an array is never null
 */
interface Shipment {
  readonly parcels: readonly number[] | null;
}

export function parcelCount(shipment: Shipment): number {
  return shipment.parcels === null ? 0 : shipment.parcels.length;
}
