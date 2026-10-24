/**
 * Rejected: a shape that contains itself through an array.
 *
 * A tree of categories has no fixed depth, and PostgreSQL cannot declare it:
 * the array type of a composite exists only once the composite does.
 *
 *     CREATE TYPE app.category AS (name text, children app.category[]);
 *     -- ERROR: type "app.category[]" does not exist
 *
 * Expected: `Category` contains itself through an array
 */
interface Category {
  readonly name: string;
  readonly children: readonly Category[];
}

export function childCount(category: Category): number {
  return category.children.length;
}
