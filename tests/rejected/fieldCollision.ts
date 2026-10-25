/**
 * Rejected: two fields that are the same column.
 *
 * Field names are mapped to `snake_case`, so `fooBar` and `foo_bar` would both be
 * the column `foo_bar`:
 *
 *     CREATE TYPE app.clashing AS (foo_bar text, foo_bar text);  -- invalid
 *
 * Rename one of the fields.
 *
 * Expected: are both the column `foo_bar`
 */
type Clashing = {
  fooBar: string;
  foo_bar: string;
};

export function pick(clashing: Clashing): string {
  return clashing.fooBar;
}
