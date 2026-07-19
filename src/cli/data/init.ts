import type { InitializeProjectResult } from "../../application/init/use-case.js";
import { t } from "../../i18n/index.js";
import type { CliScreenNode } from "../presentation/page.js";
import { terminalTheme, type TerminalTheme } from "../presentation/theme.js";
import type { CliDataPage } from "./page.js";

export interface InitData extends InitializeProjectResult {
  readonly schema: "benchpilot.init";
  readonly version: 1;
}

const displayWidth = (value: string) =>
  [...value].reduce(
    (width, character) => width + (character.codePointAt(0)! > 0xff ? 2 : 1),
    0,
  );

const row = (label: string, value: string, theme: TerminalTheme) => ({
  text: `${theme.muted(`${label}${" ".repeat(Math.max(1, 12 - displayWidth(label)))}`)}${theme.argument(value)}`,
});

/** Presents the initialized project while retaining a natural machine DTO. */
export const initDataPage = (
  result: InitializeProjectResult,
): CliDataPage<InitData> => {
  const data: InitData = {
    schema: "benchpilot.init",
    version: 1,
    ...result,
  };
  return {
    data,
    jsonl: [{ key: "project", value: data.project }],
    screen: ({ locale, color }): readonly CliScreenNode[] => {
      const theme = terminalTheme(color);
      return [
        {
          text: theme.heading(
            t(locale, data.existing ? "init.applied" : "init.done"),
          ),
        },
        {
          text: theme.heading(t(locale, "init.project")),
          children: [
            ...(data.project.name
              ? [row(t(locale, "init.projectName"), data.project.name, theme)]
              : []),
            ...(data.project.id
              ? [row(t(locale, "init.projectId"), data.project.id, theme)]
              : []),
            row(
              t(locale, "init.enabledAdapters"),
              data.adapters.enabled.length
                ? data.adapters.enabled.join(", ")
                : t(locale, "init.none"),
              theme,
            ),
          ],
        },
      ];
    },
  };
};
