/**
 * Rejected: a field of an object type that may be null.
 *
 * The field would be a column of a composite type, and `IS NULL` on a composite
 * is also true for a row whose fields are all NULL:
 *
 *     SELECT (ROW(NULL)::app.inner_value) IS NULL;  -- true
 *
 * so `foo: null` and `foo: { bar: null }` would be two TypeScript values SQL
 * cannot tell apart. Make the field non-nullable, or the nested fields `T | null`.
 *
 * Expected: `MaybeInner.foo` is an object that may be null
 */
type InnerValue = { bar: string | null };

type MaybeInner = {
  foo: InnerValue | null;
};

export function hasFoo(maybe: MaybeInner): boolean {
  return maybe.foo !== null;
}
