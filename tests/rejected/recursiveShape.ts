/**
 * Rejected: a recursive object type.
 *
 * A field of an object type is a column of that type's composite, and a type
 * that contains itself has no fixed depth. PostgreSQL forbids it too:
 *
 *     CREATE TYPE app.tree_node AS (label text, child app.tree_node);
 *     -- ERROR: composite type tree_node cannot be made a member of itself
 *
 * Expected: `TreeNode` contains itself
 */
interface TreeNode {
  label: string;
  child: TreeNode;
}

export function labelOf(node: TreeNode): string {
  return node.label;
}
