import type { ScreenRenderContext } from "../output/engine.js";
import { renderHelpView } from "../views/screen-renderer.js";
import type { HelpData } from "./projector.js";

export const renderHelpData = (
  data: HelpData,
  context: ScreenRenderContext,
  showWordmark: boolean,
) => renderHelpView(data, { ...context, showWordmark });
