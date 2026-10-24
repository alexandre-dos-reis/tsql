/**
 * Rejected: `includes` on an array of objects.
 *
 * `includes` compares objects by identity: a different object with the same
 * fields is not found. SQL compares composites by value, so the same call
 * would find it:
 *
 *     SELECT array_position(ARRAY[ROW('a')::app.tag], ROW('a')::app.tag);  -- 1
 *
 * Loop over the array and compare the fields you care about.
 *
 * Expected: `includes` on an array of objects compares identity in TypeScript
 */
interface Tag {
  readonly name: string;
}

export function hasTag(tags: readonly Tag[], tag: Tag): boolean {
  return tags.includes(tag); // ← rejected here
}
