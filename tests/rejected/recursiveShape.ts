/**
 * Rejected: a recursive object type.
 *
 * Nested shapes are flattened into columns, and a type that contains itself would
 * flatten forever. (PostgreSQL also forbids a composite type that contains itself.)
 */
interface TreeNode {
  label: string;
  child: TreeNode;
}

export function labelOf(node: TreeNode): string {
  return node.label;
}
