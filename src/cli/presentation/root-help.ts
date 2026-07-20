import { t, type Locale } from "../../i18n/index.js";
import type { HelpData } from "../help/projector.js";
import type { PromptItem } from "../interaction/prompter.js";
import { displayWidth } from "../terminal/text.js";
import { benchPilotWordmark } from "./brand.js";
import { terminalTheme } from "./theme.js";

/** Projects the root CommandCollection into grouped Inquirer choices. */
export function rootMenuChoices(
  data: HelpData,
  color = false,
): readonly PromptItem[] {
  const theme = terminalTheme(color);
  const groups = data.groups
    .filter((group) => group.views.includes(data.interactionView ?? ""))
    .sort((left, right) => left.order - right.order);
  const children = groups.flatMap((group) =>
    data.children
      .filter((child) => child.groupId === group.id)
      .sort((left, right) => (left.order ?? 0) - (right.order ?? 0)),
  );
  const width = Math.max(
    1,
    ...children.map((child) => displayWidth(String(child.path[0] ?? ""))),
  );
  return groups.flatMap((group) => [
    { separator: theme.heading(group.label.text) },
    ...data.children
      .filter((child) => child.groupId === group.id)
      .sort((left, right) => (left.order ?? 0) - (right.order ?? 0))
      .map((child) => {
        const command = String(child.path[0] ?? "");
        const padding = " ".repeat(Math.max(0, width - displayWidth(command)));
        return {
          value: command,
          label: `${theme.command(`${command}${padding}`)}  ${child.navigationSummary?.text ?? child.summary.text}`,
        };
      }),
  ]);
}

/** Header shown above the persistent, searchable interactive command menu. */
export function renderInteractiveHomeHeader(
  locale: Locale,
  color: boolean,
  showWordmark: boolean,
) {
  const theme = terminalTheme(color);
  const wordmark = showWordmark ? benchPilotWordmark : "";
  return `${theme.brand(wordmark)}\n\n${theme.muted(t(locale, "help.group.root"))}\n\n`;
}
