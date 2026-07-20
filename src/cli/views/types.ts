import type { ScreenRenderContext } from "../output/engine.js";
import type { HelpData } from "../help/projector.js";

export type HelpViewBlock =
  | { readonly component: "Brand"; readonly asset: "benchpilot-wordmark" }
  | {
      readonly component: "Text";
      readonly source: "summary";
      readonly tone: "heading" | "muted";
    }
  | { readonly component: "Description" }
  | { readonly component: "UsageList" }
  | {
      readonly component: "CommandCollection";
      readonly widthGroup: string;
    }
  | { readonly component: "ChildList"; readonly widthGroup: string }
  | {
      readonly component: "FieldList";
      readonly source: "arguments" | "options" | "globalOptions";
      readonly widthGroup: string;
    }
  | { readonly component: "ExampleList" }
  | { readonly component: "ErrorList" }
  | { readonly component: "MessageList"; readonly source: "footer" }
  | { readonly component: "SafetyDetail" }
  | { readonly component: "OutputDetail" };

export interface HelpViewDefinition {
  readonly id: string;
  readonly blocks: readonly HelpViewBlock[];
}

export interface HelpViewRenderContext extends ScreenRenderContext {
  readonly showWordmark: boolean;
}

export interface ComponentRenderContext {
  readonly data: HelpData;
  readonly screen: HelpViewRenderContext;
  readonly widths: Readonly<Record<string, number>>;
}

export interface HelpScreenComponent<Block extends HelpViewBlock> {
  measure?(block: Block, data: HelpData): number;
  render(block: Block, context: ComponentRenderContext): string;
}
