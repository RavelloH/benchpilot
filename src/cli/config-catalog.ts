import { t, type Locale, type MessageKey } from "../i18n/index.js";
import {
  configurationCatalog as configurationSemantics,
  type ConfigurationCatalogEntry as SemanticConfigurationCatalogEntry,
} from "../application/config/catalog.js";
import type { PromptChoice } from "./interaction/prompter.js";
import { terminalTheme } from "./presentation/theme.js";
import { displayWidth, padDisplay } from "./terminal/text.js";

export interface ConfigurationCatalogEntry extends SemanticConfigurationCatalogEntry {
  readonly name: MessageKey;
  readonly description: MessageKey;
  readonly choices?: readonly {
    readonly value: string;
    readonly name: MessageKey;
    readonly description: MessageKey;
  }[];
}

const entryMessages: Record<
  (typeof configurationSemantics)[number]["key"],
  { readonly name: MessageKey; readonly description: MessageKey }
> = {
  "project.id": {
    name: "configCatalog.projectId.name",
    description: "configCatalog.projectId.description",
  },
  "project.name": {
    name: "configCatalog.projectName.name",
    description: "configCatalog.projectName.description",
  },
  "defaults.timeout": {
    name: "configCatalog.timeout.name",
    description: "configCatalog.timeout.description",
  },
  "adapters.enabled": {
    name: "configCatalog.enabledAdapters.name",
    description: "configCatalog.enabledAdapters.description",
  },
  "approval.level": {
    name: "configCatalog.approvalLevel.name",
    description: "configCatalog.approvalLevel.description",
  },
  "cli.locale": {
    name: "configCatalog.locale.name",
    description: "configCatalog.locale.description",
  },
};

const choiceMessages: Record<
  string,
  { readonly name: MessageKey; readonly description: MessageKey }
> = {
  strict: {
    name: "configCatalog.approvalLevel.strict.name",
    description: "configCatalog.approvalLevel.strict.description",
  },
  default: {
    name: "configCatalog.approvalLevel.default.name",
    description: "configCatalog.approvalLevel.default.description",
  },
  bypass: {
    name: "configCatalog.approvalLevel.bypass.name",
    description: "configCatalog.approvalLevel.bypass.description",
  },
  en: {
    name: "configCatalog.locale.en.name",
    description: "configCatalog.locale.en.description",
  },
  "zh-CN": {
    name: "configCatalog.locale.zhCN.name",
    description: "configCatalog.locale.zhCN.description",
  },
};

/** CLI wording and layout projected from the Application catalog. */
export const configurationCatalog: readonly ConfigurationCatalogEntry[] =
  configurationSemantics.map(({ choices, ...entry }) => ({
    ...entry,
    ...entryMessages[entry.key]!,
    ...(choices
      ? {
          choices: choices.map((choice) => ({
            ...choice,
            ...choiceMessages[choice.value]!,
          })),
        }
      : {}),
  }));

export const configurationCatalogEntry = (key: string) =>
  configurationCatalog.find((entry) => entry.key === key);

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
    label: `${theme.command(padDisplay(entry.key, keyWidth, 0))}  ${padDisplay(names[index]!, nameWidth, 0)}  ${theme.muted(t(locale, entry.description))}`,
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
    label: `${theme.command(padDisplay(choice.value, valueWidth, 0))}  ${padDisplay(names[index]!, nameWidth, 0)}  ${theme.muted(t(locale, choice.description))}`,
  }));
};
