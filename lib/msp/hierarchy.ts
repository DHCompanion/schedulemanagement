export interface OutlineNode {
  externalUid: number;
  outlineLevel: number;
}

/**
 * Derive each node's parent UID from outline levels in document order.
 * Parent = nearest preceding node with a strictly smaller outline level.
 */
export function deriveParents<T extends OutlineNode>(nodes: T[]): Map<number, number | null> {
  const result = new Map<number, number | null>();
  const stack: T[] = [];
  for (const node of nodes) {
    while (stack.length && stack[stack.length - 1].outlineLevel >= node.outlineLevel) stack.pop();
    result.set(node.externalUid, stack.length ? stack[stack.length - 1].externalUid : null);
    stack.push(node);
  }
  return result;
}
