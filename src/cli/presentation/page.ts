/** A screen-only tree shared by document and data renderers. */
export interface CliScreenNode {
  readonly text?: string;
  readonly children?: readonly CliScreenNode[];
  readonly lineBreak?: boolean;
}

export function renderScreenNodes(nodes: readonly CliScreenNode[]) {
  const renderNode = (
    node: CliScreenNode,
    depth: number,
  ): string | undefined => {
    const hasText = node.text !== undefined;
    const children = (node.children ?? [])
      .flatMap((child) => [renderNode(child, hasText ? depth + 1 : depth)])
      .filter((value): value is string => value !== undefined);
    const text = hasText ? `${"  ".repeat(depth)}${node.text}` : undefined;
    const rendered =
      text && children.length
        ? `${text}\n${children.join("\n")}`
        : (text ?? children.join("\n"));
    return node.lineBreak ? `${rendered}\n` : rendered;
  };
  const page = nodes
    .flatMap((node) => [renderNode(node, 0)])
    .filter((value): value is string => value !== undefined)
    .join("\n\n");
  return page ? `${page}\n` : "";
}
