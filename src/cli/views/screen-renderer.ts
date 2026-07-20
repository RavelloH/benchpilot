import type { HelpData } from "../help/projector.js";
import { helpScreenComponents } from "./components.js";
import { helpViewDefinitions } from "./help-views.js";
import type { HelpViewRenderContext } from "./types.js";

const helpViews = new Map(
  helpViewDefinitions.map((definition) => [definition.id, definition]),
);

/** Generic two-pass renderer: measure shared columns, then render blocks. */
export const renderHelpView = (
  data: HelpData,
  screen: HelpViewRenderContext,
) => {
  const view = helpViews.get(data.view);
  if (!view) throw new Error(`Unknown help view: ${data.view}`);

  const widths: Record<string, number> = {};
  for (const block of view.blocks) {
    if (!("widthGroup" in block)) continue;
    const measured = helpScreenComponents[block.component].measure?.(
      block,
      data,
    );
    widths[block.widthGroup] = Math.max(
      widths[block.widthGroup] ?? 1,
      measured ?? 1,
    );
  }

  const context = { data, screen, widths };
  const output = view.blocks
    .map((block) =>
      helpScreenComponents[block.component].render(block, context),
    )
    .filter(Boolean)
    .join("\n\n");
  return `${output}\n`;
};
