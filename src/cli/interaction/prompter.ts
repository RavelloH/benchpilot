import { input, select } from "@inquirer/prompts";
import searchPrompt from "@inquirer/search";
import { Separator } from "@inquirer/select";
import type { Locale } from "../../i18n/index.js";
import { t } from "../../i18n/index.js";
import { terminalTheme } from "../presentation/theme.js";

export const INTERACTION_BACK = "__benchpilot_interaction_back__";
export const INTERACTION_EXIT = "__benchpilot_interaction_exit__";

export interface PromptChoice {
  value: string;
  label?: string;
}

export interface PromptSeparator {
  separator: string;
}

export type PromptItem = PromptChoice | PromptSeparator;

export interface PromptOptions {
  pageSize?: number;
  searchable?: boolean;
}

export interface InteractionDriver {
  choose(input: {
    message: string;
    choices: readonly PromptItem[];
    pageSize?: number;
    searchable?: boolean;
  }): Promise<string | undefined>;
  value(input: {
    message: string;
    validate: (value: string) => true | string;
  }): Promise<string | undefined>;
}

const filterPromptItems = (
  choices: readonly PromptItem[],
  term: string | undefined,
) => {
  const query = term?.trim().toLocaleLowerCase();
  if (!query) return choices;
  const result: PromptItem[] = [];
  let separator: PromptSeparator | undefined;
  let section: PromptChoice[] = [];
  const appendSection = () => {
    if (!separator) return;
    const separatorMatches = separator.separator
      .toLocaleLowerCase()
      .includes(query);
    const matches = separatorMatches
      ? section
      : section.filter((choice) =>
          `${choice.value} ${choice.label ?? ""}`
            .toLocaleLowerCase()
            .includes(query),
        );
    if (matches.length) result.push(separator, ...matches);
  };
  for (const choice of choices) {
    if ("separator" in choice) {
      appendSection();
      separator = choice;
      section = [];
    } else {
      section.push(choice);
    }
  }
  appendSection();
  return result;
};

const createInquirerDriver = (locale: Locale): InteractionDriver => ({
  choose: async ({ message, choices, pageSize, searchable }) => {
    const theme = {
      style: {
        keysHelpTip: () =>
          t(locale, searchable ? "menu.searchKeysHelp" : "menu.keysHelp"),
      },
    };
    if (searchable)
      return searchPrompt({
        message,
        source: (term) =>
          filterPromptItems(choices, term).map((choice) =>
            "separator" in choice
              ? new Separator(choice.separator)
              : {
                  name: choice.label || choice.value,
                  value: choice.value,
                },
          ),
        pageSize,
        theme,
      });
    return select({
      message,
      choices: choices.map((choice) =>
        "separator" in choice
          ? new Separator(choice.separator)
          : {
              name: choice.label || choice.value,
              value: choice.value,
            },
      ),
      pageSize,
      theme,
    });
  },
  value: async ({ message, validate }) => input({ message, validate }),
});

const isPromptCancellation = (error: unknown) =>
  error instanceof Error &&
  ["AbortPromptError", "ExitPromptError"].includes(error.name);

export class InteractionCancelledError extends Error {
  constructor() {
    super("INTERACTION_CANCELLED");
    this.name = "INTERACTION_CANCELLED";
  }
}

export class InteractionBackError extends Error {
  constructor() {
    super("INTERACTION_BACK");
    this.name = "INTERACTION_BACK";
  }
}

export class InteractionExitedError extends Error {
  constructor() {
    super("INTERACTION_EXITED");
    this.name = "INTERACTION_EXITED";
  }
}

/** A continuous Inquirer session for a complete command-selection conversation. */
export class InteractionSession {
  private cancelled = false;
  private hasPreviousChoice = false;
  private readonly driver: InteractionDriver;

  constructor(
    private readonly locale: Locale,
    driver?: InteractionDriver,
    private readonly color = false,
  ) {
    this.driver = driver ?? createInquirerDriver(locale);
  }

  async choose(
    choices: readonly PromptItem[],
    options: PromptOptions = {},
  ): Promise<string> {
    if (!choices.length) throw new InteractionCancelledError();
    const navigation: PromptItem[] = [
      { separator: "" },
      ...(this.hasPreviousChoice
        ? [{ value: INTERACTION_BACK, label: t(this.locale, "menu.back") }]
        : []),
      {
        value: INTERACTION_EXIT,
        label: terminalTheme(this.color).error(t(this.locale, "menu.exit")),
      },
    ];
    let value: string | undefined;
    try {
      value = await this.driver.choose({
        message: t(this.locale, "menu.choose"),
        choices: [...choices, ...navigation],
        pageSize: options.pageSize ?? 100,
        searchable: options.searchable,
      });
    } catch (error) {
      if (!isPromptCancellation(error)) throw error;
      this.cancelled = true;
    }
    if (this.cancelled || typeof value !== "string")
      throw new InteractionCancelledError();
    if (value === INTERACTION_EXIT) throw new InteractionExitedError();
    if (value === INTERACTION_BACK) throw new InteractionBackError();
    this.hasPreviousChoice = true;
    return value;
  }

  async value(name: string): Promise<string> {
    let value: string | undefined;
    try {
      value = await this.driver.value({
        message: t(this.locale, "menu.value", { name }),
        validate: (value) =>
          String(value).trim() ? true : t(this.locale, "menu.invalid"),
      });
    } catch (error) {
      if (!isPromptCancellation(error)) throw error;
      this.cancelled = true;
    }
    if (this.cancelled || typeof value !== "string")
      throw new InteractionCancelledError();
    return value.trim();
  }

  close() {}
}

export async function promptInit(input: {
  locale: Locale;
  projectId?: string;
  projectName?: string;
  selectedLocale?: Locale;
  driver?: InteractionDriver;
  color?: boolean;
}): Promise<{ projectId: string; projectName: string; locale: Locale }> {
  const bootstrap = new InteractionSession(
    input.locale,
    input.driver,
    input.color,
  );
  const locale =
    input.selectedLocale ??
    ((await bootstrap.choose([
      { value: "en", label: "English" },
      { value: "zh-CN", label: "简体中文" },
    ])) as Locale);
  const session = new InteractionSession(locale, input.driver, input.color);
  const projectId =
    input.projectId ?? (await session.value(t(locale, "init.projectId")));
  const projectName =
    input.projectName ?? (await session.value(t(locale, "init.projectName")));
  return { projectId, projectName, locale };
}
