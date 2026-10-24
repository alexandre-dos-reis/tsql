interface TreeNode {
  label: string;
  child: TreeNode;
}

export function labelOf(node: TreeNode): string {
  return node.label;
}
