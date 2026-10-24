import type { Integer } from "../../src/pgtypes";

/**
 * A field declared `Integer` in an object type is an `integer` column, exactly as a parameter would
 * be: the field is mapped from the type its author wrote, not from the `number` the checker sees.
 */
type Ticket = { label: string; count: Integer };

export function nextCount(ticket: Ticket): Integer {
  return ticket.count + 1;
}
