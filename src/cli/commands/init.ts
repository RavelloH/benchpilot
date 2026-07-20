import type { Adapter } from "../../core.js";
import { BenchPilotError, fail } from "../../core.js";
import { createApplication } from "../../application/application.js";
import {
  readGlobalLocaleSetting,
  writeGlobalLocale,
} from "../../application/config/locale.js";
import {
  globalOptionDefinitions,
  staticCommandDefinitions,
} from "../../application/commands/definitions.js";
import { CommandArgvParser } from "../../application/commands/parser.js";
import { CommandResolver } from "../../application/commands/resolver.js";
import { isLocale, t, type Locale } from "../../i18n/index.js";
import { initDataPage } from "../data/init.js";
import type { CliDataPage } from "../data/page.js";
import { InteractionEngine } from "../interaction/engine.js";
import type { InteractionSession } from "../interaction/prompter.js";
import { terminalTheme } from "../presentation/theme.js";
import { displayWidth, padDisplay } from "../terminal/text.js";
import { parseCommandState } from "./command-intent.js";

const staticProvider = { values: async () => [] };
const staticGraph = {
  parser: new CommandArgvParser(
    staticCommandDefinitions,
    globalOptionDefinitions,
    staticProvider,
  ),
  resolver: new CommandResolver(staticCommandDefinitions, staticProvider),
  globalOptions: globalOptionDefinitions,
};

export interface InitCommandHandlerInput {
  readonly path: readonly string[];
  readonly values: Readonly<Record<string, unknown>>;
  readonly cwd: string;
  readonly color: boolean;
  readonly canInteract: boolean;
  readonly interaction: (locale: Locale) => InteractionSession;
  readonly loadAdapters: () => Promise<Adapter[]>;
  readonly setPresentationLocale: (locale: Locale) => void;
  readonly selected: () => void;
  readonly render: (input: {
    readonly page: CliDataPage<object>;
    readonly locale: Locale;
  }) => void;
}

/** Executes initialization from the shared field recipe and data-page output. */
export const handleInitCommand = async (input: InitCommandHandlerInput) => {
  if (input.path[0] !== "init") return false;
  if (input.values["project-id"] !== undefined)
    fail(
      "USAGE_ERROR",
      2,
      "init generates the project ID automatically; omit --project-id.",
    );
  const suppliedLocale = input.values.locale;
  const persistedLocale = await readGlobalLocaleSetting();
  const requestedLocale = isLocale(suppliedLocale) ? suppliedLocale : undefined;
  const initialLocale: Locale = persistedLocale ?? requestedLocale ?? "en";
  const projectName =
    typeof input.values["project-name"] === "string"
      ? input.values["project-name"]
      : undefined;
  const application = createApplication([]);
  if (await application.hasProjectConfig(input.cwd)) {
    input.setPresentationLocale(initialLocale);
    input.selected();
    input.render({
      page: initDataPage(
        await application.initializeProject({
          cwd: input.cwd,
          projectName: "",
          enabledAdapters: [],
        }),
      ),
      locale: initialLocale,
    });
    return true;
  }
  const selectedLocale = persistedLocale ?? requestedLocale;
  if (!input.canInteract && !(projectName && selectedLocale))
    input.interaction(initialLocale);
  const available = await input.loadAdapters();
  const values = {
    ...input.values,
    ...(selectedLocale ? { locale: selectedLocale } : {}),
  };
  let parsed = await parseCommandState({
    graph: staticGraph,
    path: ["init"],
    values,
  });
  if (input.canInteract) {
    const completion = await new InteractionEngine(
      input.interaction(initialLocale),
      initialLocale,
      {
        "supported-locales": () => [
          { value: "en", label: "English" },
          { value: "zh-CN", label: "简体中文" },
        ],
        "available-adapters": ({ values: currentValues }) => {
          const locale = isLocale(currentValues.locale)
            ? currentValues.locale
            : initialLocale;
          const width = Math.max(
            1,
            ...available.map((adapter) => displayWidth(adapter.id)),
          );
          const theme = terminalTheme(input.color);
          return {
            choices: available.map((adapter) => ({
              value: adapter.id,
              label: `${theme.command(padDisplay(adapter.id, width))}  ${adapter.summary}`,
            })),
            multiple: true,
            prompt: t(locale, "init.adapters"),
          };
        },
      },
    ).complete(parsed);
    parsed = await parseCommandState({
      graph: staticGraph,
      path: completion.path,
      values: { ...values, ...completion.values },
    });
  }
  const result = {
    projectName: String(parsed.intent.options["project-name"] ?? ""),
    locale: String(parsed.intent.options.locale ?? initialLocale),
    enabledAdapters: Array.isArray(parsed.intent.options.adapter)
      ? parsed.intent.options.adapter.map(String)
      : parsed.intent.options.adapter === undefined
        ? []
        : [String(parsed.intent.options.adapter)],
  };
  if (!result.projectName || !isLocale(result.locale)) {
    if (!input.canInteract) input.interaction(initialLocale);
    throw new BenchPilotError(
      "USAGE_ERROR",
      2,
      "init requires a project name and locale.",
    );
  }
  const locale = result.locale;
  input.setPresentationLocale(locale);
  input.selected();
  input.render({
    page: initDataPage(
      await application.initializeProject({
        cwd: input.cwd,
        projectName: result.projectName,
        enabledAdapters: result.enabledAdapters,
      }),
    ),
    locale,
  });
  if (!persistedLocale) await writeGlobalLocale({ locale });
  return true;
};
