/**
 * Rejected: two fields that flatten to the same column.
 *
 * Nested shapes become prefixed columns, so `foo.bar` and `fooBar` would both be
 * the column `foo_bar`:
 *
 *     CREATE TYPE app.clashing AS (foo_bar text, foo_bar text);  -- invalid
 *
 * Rename one of the fields.
 *
 * Expected: both flatten to the column `foo_bar`
 */
type Clashing = {
  foo: { bar: string };
  fooBar: string;
};

export function pick(clashing: Clashing): string {
  return clashing.fooBar;
}
