import type { StaticOutputDefinition } from "../output/engine.js";
import { renderHelpData } from "../help/renderer.js";
import type { HelpData } from "../help/projector.js";

export const helpOutputDefinition = (
  data: HelpData,
  showWordmark: boolean,
): StaticOutputDefinition<HelpData> => ({
  command: {
    id: data.command.id === "root" ? "help" : data.command.id,
    path: data.command.id === "root" ? [] : data.command.path.map(String),
  },
  kind: "help",
  data,
  snapshots: [{ key: "help", value: data }],
  renderScreen(value, context) {
    return renderHelpData(value, context, showWordmark);
  },
});
