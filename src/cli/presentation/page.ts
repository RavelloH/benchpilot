import type { Locale } from "../../i18n/index.js";

/** Internal visibility controls. They are never part of machine output. */
export type CliVisibility = "screen" | "json" | "jsonl";

/** A screen-only tree shared by document and data renderers. */
export interface CliScreenNode {
  readonly text?: string;
  readonly children?: readonly CliScreenNode[];
  readonly lineBreak?: boolean;
}

/**
 * The presentation tree emitted by CLI text-generation code.
 *
 * `name` is intentionally local to its parent. The JSONL projection derives
 * a complete dotted key while walking the tree.
 */
interface CliNodeBase {
  readonly name: string;
  readonly visibility: readonly CliVisibility[];
  /** Screen-only layout hint; deliberately excluded from machine projections. */
  readonly lineBreak?: boolean;
}

export type CliNode =
  | (CliNodeBase & {
      readonly text: string;
      readonly children?: readonly CliNode[];
    })
  | (CliNodeBase & {
      readonly text?: string;
      readonly children: readonly CliNode[];
    });

export type PresentationView = "normal" | "agent" | "help";

export interface PresentationNode {
  readonly name: string;
  readonly text?: string;
  readonly children?: readonly PresentationNode[];
}

export interface PresentationJsonlStart {
  readonly op: "start";
  readonly protocol: "benchpilot.presentation";
  readonly version: 1;
  readonly locale: Locale;
  readonly view: PresentationView;
}

export interface PresentationJsonlSnapshot {
  readonly op: "snapshot";
  readonly index: number;
  readonly key: string;
  readonly text?: string;
}

export interface PresentationJsonlComplete {
  readonly op: "complete";
  readonly count: number;
}

const ansiPattern =
  /\u001B(?:\][^\u0007]*(?:\u0007|\u001B\\)|\[[0-?]*[ -/]*[@-~])/g;

export function presentationView(input: {
  help: boolean | undefined;
  agentDetected: boolean;
  agentMode: boolean;
}): PresentationView {
  if (input.help) return "help";
  if (input.agentDetected || input.agentMode) return "agent";
  return "normal";
}

/** Remove terminal control sequences and presentation-only whitespace. */
export function cleanPresentationText(value: string) {
  return value
    .replace(ansiPattern, "")
    .replace(/[\r\n]+/g, " ")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function projectNodes(
  nodes: readonly CliNode[],
  visibility: CliVisibility,
  cleanText: boolean,
): PresentationNode[] {
  return nodes.flatMap((node) => {
    if (!node.visibility.includes(visibility)) return [];
    const children = node.children
      ? projectNodes(node.children, visibility, cleanText)
      : undefined;
    if (node.text === undefined && !children?.length) return [];
    return [
      {
        name: node.name,
        ...(node.text === undefined
          ? {}
          : { text: cleanText ? cleanPresentationText(node.text) : node.text }),
        ...(children?.length ? { children } : {}),
      },
    ];
  });
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

function screenNodes(nodes: readonly CliNode[]): CliScreenNode[] {
  return nodes.flatMap((node) => {
    if (!node.visibility.includes("screen")) return [];
    return [
      {
        ...(node.text === undefined ? {} : { text: node.text }),
        ...(node.children ? { children: screenNodes(node.children) } : {}),
        ...(node.lineBreak ? { lineBreak: true } : {}),
      },
    ];
  });
}

export function screenPresentation(nodes: readonly CliNode[]) {
  return renderScreenNodes(screenNodes(nodes));
}

export function jsonPresentation(nodes: readonly CliNode[]) {
  return projectNodes(nodes, "json", true);
}

export function jsonlPresentation(nodes: readonly CliNode[]) {
  const output: PresentationJsonlSnapshot[] = [];
  const visit = (items: readonly PresentationNode[], parent: string[]) => {
    for (const node of items) {
      const key = [...parent, node.name].join(".");
      output.push({
        op: "snapshot",
        index: output.length,
        key,
        ...(node.text === undefined ? {} : { text: node.text }),
      });
      if (node.children) visit(node.children, [...parent, node.name]);
    }
  };
  visit(projectNodes(nodes, "jsonl", true), []);
  return output;
}
