import type { CommandInteractionEntry } from "../../application/commands/interaction.js";
import { resolveMessage, type Locale } from "../../i18n/index.js";
import { terminalTheme } from "../presentation/theme.js";
import { displayWidth, padDisplay } from "../terminal/text.js";
import type { PromptChoice } from "./prompter.js";

/** Renders command-source menu entries with stable terminal columns. */
export const interactionMenuChoices = (
  entries: readonly CommandInteractionEntry[],
  locale: Locale,
  color: boolean,
): PromptChoice[] => {
  if (!entries.length) return [];
  const width = Math.max(...entries.map((entry) => displayWidth(entry.value)));
  const theme = terminalTheme(color);
  return entries.map((entry) => ({
    value: entry.value,
    label: `${theme.command(padDisplay(entry.value, width, 0))}  ${resolveMessage(locale, entry.summary)}`,
  }));
};
