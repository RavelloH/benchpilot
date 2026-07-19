import { confirm, input, select } from "@inquirer/prompts";
import searchPrompt from "@inquirer/search";
import { Separator } from "@inquirer/select";
import {
  createPrompt,
  isDownKey,
  isEnterKey,
  isTabKey,
  isUpKey,
  useEffect,
  useKeypress,
  useRef,
  useState,
} from "@inquirer/core";
import type { Locale } from "../../i18n/index.js";
import { t } from "../../i18n/index.js";
import { terminalTheme } from "../presentation/theme.js";

export const INTERACTION_BACK = "__benchpilot_interaction_back__";
export const INTERACTION_EXIT = "__benchpilot_interaction_exit__";
const EXIT_CONFIRM_TIMEOUT_MS = 1_200;
const RETURN_ESCAPE_DEBOUNCE_MS = 500;

export const interactionShortcut = (input: string) => {
  if (input === "\u001b") return INTERACTION_BACK;
  if (input.includes("\u0018")) return INTERACTION_EXIT;
  return undefined;
};

export const compactPromptAnswer = (value: string) =>
  value.replace(/[ \t]+/g, " ");

/** Shared visual divider for all interactive menu sections. */
export const menuDivider = (color = false) =>
  terminalTheme(color).muted("──────────────");

export interface PromptChoice {
  value: string;
  label?: string;
  /** Preview shown below the menu for the currently highlighted choice. */
  description?: string;
}

export interface PromptSeparator {
  separator: string;
}

export type PromptItem = PromptChoice | PromptSeparator;

export interface PromptOptions {
  pageSize?: number;
  searchable?: boolean;
  /** Path prepended to the selected value in the command preview. */
  commandPath?: readonly string[];
  /** Menu path to use if a child screen subsequently chooses Back. */
  nextBackPath?: readonly string[];
  /** Consume the Esc byte that was already used to return to this menu. */
  ignoreInitialEscape?: boolean;
}

export interface InteractionDriver {
  choose(input: {
    message: string;
    choices: readonly PromptItem[];
    pageSize?: number;
    searchable?: boolean;
    /** Use the double-Esc exit confirmation when no Back action exists. */
    exitConfirmation?: boolean;
    ignoreInitialEscape?: boolean;
  }): Promise<string | undefined>;
  value(input: {
    message: string;
    validate: (value: string) => true | string;
  }): Promise<string | undefined>;
  confirm?(input: { message: string; default: boolean }): Promise<boolean>;
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
    const separatorMatches =
      separator?.separator.toLocaleLowerCase().includes(query) ?? false;
    const matches = separatorMatches
      ? section
      : section.filter((choice) =>
          `${choice.value} ${choice.label ?? ""}`
            .toLocaleLowerCase()
            .includes(query),
        );
    if (!matches.length) return;
    if (separator) result.push(separator);
    result.push(...matches);
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

interface ExitConfirmSearchConfig {
  readonly message: string;
  readonly choices: readonly PromptItem[];
  readonly color: boolean;
  readonly locale: Locale;
  readonly context: InquirerPromptContext;
  readonly ignoreInitialEscape: boolean;
}

/**
 * A persistent Inquirer prompt for first-level menus. Exit confirmation is
 * local state, so Esc never aborts and recreates a readline prompt.
 */
const exitConfirmSearchPrompt = createPrompt<string, ExitConfirmSearchConfig>(
  (config, done) => {
    const theme = terminalTheme(config.color);
    const [term, setTerm] = useState("");
    const [active, setActive] = useState(0);
    const [exitArmed, setExitArmed] = useState(false);
    const [ignoreEscape, setIgnoreEscape] = useState(
      config.ignoreInitialEscape,
    );
    const [status, setStatus] = useState<"idle" | "done">("idle");
    const [answer, setAnswer] = useState<PromptChoice | undefined>();
    const exitArmedRef = useRef(false);
    const ignoredKeypressEscapes = useRef(0);
    const items = filterPromptItems(config.choices, term);
    const selectable = items.filter(
      (item): item is PromptChoice => !("separator" in item),
    );
    const activeIndex = Math.min(active, Math.max(selectable.length - 1, 0));
    const activeChoice = selectable[activeIndex];

    useEffect(() => {
      setActive(0);
    }, [term]);
    useEffect(() => {
      if (!exitArmed) return;
      const timer = setTimeout(() => {
        exitArmedRef.current = false;
        setExitArmed(false);
      }, EXIT_CONFIRM_TIMEOUT_MS);
      return () => clearTimeout(timer);
    }, [exitArmed]);
    useEffect(() => {
      if (!ignoreEscape) return;
      const timer = setTimeout(
        () => setIgnoreEscape(false),
        RETURN_ESCAPE_DEBOUNCE_MS,
      );
      return () => clearTimeout(timer);
    }, [ignoreEscape]);
    useEffect(() => {
      const onData = (chunk: Buffer | string) => {
        const input = String(chunk);
        const escapeCount =
          input === "\u001b" ? 1 : input === "\u001b\u001b" ? 2 : 0;
        if (escapeCount) {
          ignoredKeypressEscapes.current += escapeCount;
          for (let index = 0; index < escapeCount; index += 1) {
            if (exitArmedRef.current) {
              config.context.clearPromptOnDone = true;
              done(INTERACTION_EXIT);
              return;
            }
            exitArmedRef.current = true;
            setExitArmed(true);
          }
          return;
        }
        const shortcut = interactionShortcut(input);
        if (!shortcut) return;
        // Node's readline delays a bare Esc while it waits to distinguish it
        // from an ANSI sequence. Handle the raw byte now, then ignore its
        // eventual delayed keypress event below.
        ignoredKeypressEscapes.current += 1;
        if (shortcut === INTERACTION_EXIT || exitArmedRef.current) {
          config.context.clearPromptOnDone = true;
          done(INTERACTION_EXIT);
          return;
        }
        exitArmedRef.current = true;
        setExitArmed(true);
      };
      process.stdin.on("data", onData);
      return () => process.stdin.off("data", onData);
    }, []);
    useKeypress((key, rl) => {
      if (key.name === "escape") {
        if (ignoredKeypressEscapes.current) {
          ignoredKeypressEscapes.current -= 1;
          return;
        }
        if (ignoreEscape) {
          setIgnoreEscape(false);
          return;
        }
        if (exitArmedRef.current) {
          config.context.clearPromptOnDone = true;
          done(INTERACTION_EXIT);
        } else {
          exitArmedRef.current = true;
          setExitArmed(true);
        }
        return;
      }
      if (key.ctrl && key.name === "x") {
        exitArmedRef.current = false;
        config.context.clearPromptOnDone = true;
        done(INTERACTION_EXIT);
        return;
      }
      if (isEnterKey(key) && activeChoice) {
        if (activeChoice.value === INTERACTION_EXIT)
          config.context.clearPromptOnDone = true;
        else {
          exitArmedRef.current = false;
          setAnswer(activeChoice);
          setStatus("done");
        }
        done(activeChoice.value);
        return;
      }
      if (isTabKey(key) && activeChoice) {
        rl.clearLine(0);
        rl.write(activeChoice.label ?? activeChoice.value);
        setTerm(activeChoice.label ?? activeChoice.value);
        return;
      }
      if (isUpKey(key) || isDownKey(key)) {
        rl.clearLine(0);
        if (selectable.length) {
          const offset = isUpKey(key) ? -1 : 1;
          setActive(
            (activeIndex + offset + selectable.length) % selectable.length,
          );
        }
        return;
      }
      setTerm(rl.line);
    });

    if (status === "done" && answer)
      return `${theme.success("✓")} ${config.message} ${compactPromptAnswer(answer.label ?? answer.value)}`;

    const header = [theme.argument("?"), config.message, term]
      .filter(Boolean)
      .join(" ");
    const choices = items.map((item) => {
      if ("separator" in item) return ` ${item.separator}`;
      const label =
        item.value === INTERACTION_EXIT && exitArmed
          ? theme.danger(` ${t(config.locale, "menu.exitConfirm")} `)
          : (item.label ?? item.value);
      return `${item === activeChoice ? "❯" : " "} ${label}`;
    });
    const description = activeChoice?.description;
    const help = t(config.locale, "menu.searchKeysHelp");
    return [
      header,
      [choices.join("\n"), "", ...(description ? [description] : []), help]
        .join("\n")
        .trimEnd(),
    ];
  },
);

interface InquirerPromptContext {
  readonly signal: AbortSignal;
  clearPromptOnDone: boolean;
}

const withShortcuts = async <T>(
  run: (context: InquirerPromptContext) => Promise<T>,
): Promise<T | typeof INTERACTION_BACK | typeof INTERACTION_EXIT> => {
  const controller = new AbortController();
  const context: InquirerPromptContext = {
    signal: controller.signal,
    clearPromptOnDone: false,
  };
  let control: typeof INTERACTION_BACK | typeof INTERACTION_EXIT | undefined;
  const onData = (chunk: Buffer | string) => {
    const shortcut = interactionShortcut(String(chunk));
    if (shortcut) {
      // Let Inquirer erase its active prompt before the router resumes the
      // previous menu. This preserves the surrounding terminal transcript.
      context.clearPromptOnDone = true;
      control = shortcut;
      controller.abort(control);
    }
  };
  process.stdin.on("data", onData);
  try {
    return await run(context);
  } catch (error) {
    if (control) return control;
    throw error;
  } finally {
    process.stdin.off("data", onData);
  }
};

const createInquirerDriver = (
  locale: Locale,
  color: boolean,
): InteractionDriver => ({
  choose: async ({
    message,
    choices,
    pageSize,
    searchable,
    exitConfirmation,
    ignoreInitialEscape,
  }) => {
    if (exitConfirmation) {
      const context: InquirerPromptContext = {
        signal: new AbortController().signal,
        clearPromptOnDone: false,
      };
      return exitConfirmSearchPrompt(
        {
          message,
          choices,
          color,
          locale,
          context,
          ignoreInitialEscape: ignoreInitialEscape === true,
        },
        context,
      );
    }
    const terminal = terminalTheme(color);
    const theme = {
      prefix: {
        idle: terminal.argument("?"),
        done: terminal.success("✓"),
      },
      style: {
        answer: compactPromptAnswer,
        description: (value: string) => value,
        keysHelpTip: () =>
          t(locale, searchable ? "menu.searchKeysHelp" : "menu.keysHelp"),
      },
    };
    if (searchable)
      return withShortcuts((context) =>
        searchPrompt(
          {
            message,
            source: (term) =>
              filterPromptItems(choices, term).map((choice) =>
                "separator" in choice
                  ? new Separator(choice.separator)
                  : {
                      name: choice.label || choice.value,
                      value: choice.value,
                      description: choice.description,
                    },
              ),
            pageSize,
            theme,
            validate: (value) => {
              context.clearPromptOnDone =
                value === INTERACTION_BACK || value === INTERACTION_EXIT;
              return true;
            },
          },
          context,
        ),
      );
    return withShortcuts((context) =>
      select(
        {
          message,
          choices: choices.map((choice) =>
            "separator" in choice
              ? new Separator(choice.separator)
              : {
                  name: choice.label || choice.value,
                  value: choice.value,
                  description: choice.description,
                },
          ),
          pageSize,
          theme,
        },
        context,
      ),
    );
  },
  value: async ({ message, validate }) => input({ message, validate }),
  confirm: async ({ message, default: defaultValue }) =>
    confirm({ message, default: defaultValue }),
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
  constructor(
    readonly path: readonly string[],
    readonly remainingPaths: readonly (readonly string[])[],
  ) {
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
  private readonly backPaths: (readonly string[])[];
  private readonly driver: InteractionDriver;

  constructor(
    private readonly locale: Locale,
    driver?: InteractionDriver,
    private readonly color = false,
    initialBackPaths: readonly (readonly string[])[] = [],
  ) {
    this.driver = driver ?? createInquirerDriver(locale, color);
    this.backPaths = [...initialBackPaths];
  }

  async choose(
    choices: readonly PromptItem[],
    options: PromptOptions = {},
  ): Promise<string> {
    if (!choices.length) throw new InteractionCancelledError();
    const theme = terminalTheme(this.color);
    const commandChoices = choices.map((choice) => {
      if ("separator" in choice || !options.commandPath) return choice;
      const command = ["benchpilot", ...options.commandPath, choice.value].join(
        " ",
      );
      return {
        ...choice,
        description: choice.description ?? `${theme.debug(`$ ${command}`)}\n`,
      };
    });
    const navigation: PromptItem[] = [
      { separator: menuDivider(this.color) },
      ...(this.backPaths.length
        ? [
            {
              value: INTERACTION_BACK,
              label: t(this.locale, "menu.back"),
              description: `${theme.debug(t(this.locale, "menu.shortcut.back"))}\n`,
            },
          ]
        : []),
      {
        value: INTERACTION_EXIT,
        label: theme.error(t(this.locale, "menu.exit")),
        description: `${theme.debug(t(this.locale, "menu.shortcut.exit"))}\n`,
      },
    ];
    let value: string | undefined;
    try {
      value = await this.driver.choose({
        message: t(this.locale, "menu.choose"),
        choices: [...commandChoices, ...navigation],
        pageSize: options.pageSize ?? 100,
        searchable: options.searchable ?? true,
        exitConfirmation: this.backPaths.length === 0,
        ignoreInitialEscape: options.ignoreInitialEscape,
      });
    } catch (error) {
      if (!isPromptCancellation(error)) throw error;
      this.cancelled = true;
    }
    if (this.cancelled || typeof value !== "string")
      throw new InteractionCancelledError();
    if (value === INTERACTION_EXIT) throw new InteractionExitedError();
    if (value === INTERACTION_BACK) {
      const path = this.backPaths.at(-1);
      if (!path) return this.choose(choices, options);
      throw new InteractionBackError(path, this.backPaths.slice(0, -1));
    }
    if (options.nextBackPath !== undefined)
      this.backPaths.push(options.nextBackPath);
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

  async confirm(message: string): Promise<boolean> {
    try {
      return (
        (await this.driver.confirm?.({ message, default: false })) === true
      );
    } catch (error) {
      if (!isPromptCancellation(error)) throw error;
      this.cancelled = true;
    }
    if (this.cancelled) throw new InteractionCancelledError();
    return false;
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
