import { t, type Locale, type MessageKey } from "../i18n/index.js";
import type { PromptChoice } from "./interaction/prompter.js";
import { terminalTheme } from "./presentation/theme.js";

export interface ConfigurationCatalogEntry {
  readonly key: string;
  readonly name: MessageKey;
  readonly description: MessageKey;
  readonly editor: "text" | "select" | "multi-select";
  readonly scopes: readonly ("local" | "project" | "global")[];
  readonly choices?: readonly {
    readonly value: string;
    readonly name: MessageKey;
    readonly description: MessageKey;
  }[];
}

/**
 * Stable, human-facing entry points for BenchPilot's built-in configuration.
 * Dynamic device instances and adapter-defined fields remain editable through
 * their containing tables rather than changing this interaction menu.
 */
export const configurationCatalog = [
  {
    key: "project.id",
    name: "configCatalog.projectId.name",
    description: "configCatalog.projectId.description",
    editor: "text",
    scopes: ["project"],
  },
  {
    key: "project.name",
    name: "configCatalog.projectName.name",
    description: "configCatalog.projectName.description",
    editor: "text",
    scopes: ["project"],
  },
  {
    key: "defaults.timeout",
    name: "configCatalog.timeout.name",
    description: "configCatalog.timeout.description",
    editor: "text",
    scopes: ["local", "project", "global"],
  },
  {
    key: "adapters.enabled",
    name: "configCatalog.enabledAdapters.name",
    description: "configCatalog.enabledAdapters.description",
    editor: "multi-select",
    scopes: ["project"],
  },
  {
    key: "approval.level",
    name: "configCatalog.approvalLevel.name",
    description: "configCatalog.approvalLevel.description",
    editor: "select",
    scopes: ["local", "global"],
    choices: [
      {
        value: "strict",
        name: "configCatalog.approvalLevel.strict.name",
        description: "configCatalog.approvalLevel.strict.description",
      },
      {
        value: "default",
        name: "configCatalog.approvalLevel.default.name",
        description: "configCatalog.approvalLevel.default.description",
      },
      {
        value: "bypass",
        name: "configCatalog.approvalLevel.bypass.name",
        description: "configCatalog.approvalLevel.bypass.description",
      },
    ],
  },
  {
    key: "cli.locale",
    name: "configCatalog.locale.name",
    description: "configCatalog.locale.description",
    editor: "select",
    scopes: ["global"],
    choices: [
      {
        value: "en",
        name: "configCatalog.locale.en.name",
        description: "configCatalog.locale.en.description",
      },
      {
        value: "zh-CN",
        name: "configCatalog.locale.zhCN.name",
        description: "configCatalog.locale.zhCN.description",
      },
    ],
  },
] as const satisfies readonly ConfigurationCatalogEntry[];

export const configurationCatalogEntry = (key: string) =>
  configurationCatalog.find((entry) => entry.key === key);

const displayWidth = (value: string) =>
  [...value].reduce(
    (width, character) => width + (character.codePointAt(0)! > 0xff ? 2 : 1),
    0,
  );

const pad = (value: string, width: number) =>
  `${value}${" ".repeat(Math.max(0, width - displayWidth(value)))}`;

/** Formats each choice as a fixed key, localized name, and localized summary. */
export const configurationMenuChoices = (
  locale: Locale,
  color: boolean,
): PromptChoice[] => {
  const theme = terminalTheme(color);
  const names = configurationCatalog.map((entry) => t(locale, entry.name));
  const keyWidth = Math.max(
    ...configurationCatalog.map((entry) => displayWidth(entry.key)),
  );
  const nameWidth = Math.max(...names.map(displayWidth));
  return configurationCatalog.map((entry, index) => ({
    value: entry.key,
    label: `${theme.command(pad(entry.key, keyWidth))}  ${pad(names[index]!, nameWidth)}  ${theme.muted(t(locale, entry.description))}`,
  }));
};

/** Formats finite configuration values as fixed value, name, and summary columns. */
export const configurationValueMenuChoices = (
  entry: ConfigurationCatalogEntry,
  locale: Locale,
  color: boolean,
): PromptChoice[] => {
  const choices = entry.choices ?? [];
  const theme = terminalTheme(color);
  const names = choices.map((choice) => t(locale, choice.name));
  const valueWidth = Math.max(
    ...choices.map((choice) => displayWidth(choice.value)),
  );
  const nameWidth = Math.max(...names.map(displayWidth));
  return choices.map((choice, index) => ({
    value: choice.value,
    label: `${theme.command(pad(choice.value, valueWidth))}  ${pad(names[index]!, nameWidth)}  ${theme.muted(t(locale, choice.description))}`,
  }));
};
