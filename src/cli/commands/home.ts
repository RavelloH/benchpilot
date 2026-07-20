import type { Locale } from "../../i18n/index.js";
import type { InteractionSession } from "../interaction/prompter.js";
import {
  renderInteractiveHomeHeader,
  rootMenuChoices,
} from "../presentation/root-help.js";
import { fail } from "../../core.js";
import type { HelpData } from "../help/projector.js";

export type HomeCommandResult =
  | { readonly handled: false }
  | { readonly handled: true; readonly nextPath?: readonly string[] };

export interface HomeCommandHandlerInput {
  readonly path: readonly string[];
  readonly loadLocale: () => Promise<Locale>;
  readonly color: boolean;
  readonly showWordmark: boolean;
  readonly interactionAllowed: boolean;
  readonly interaction: () => InteractionSession;
  readonly rootHelp: () => Promise<HelpData>;
  readonly write: (value: string) => void;
  readonly selected: () => void;
  readonly renderRootHelp: () => Promise<void>;
  readonly renderVersion: (locale: Locale) => void;
  readonly ignoreInitialEscape: boolean;
}

/** Runs the graph-projected home menu without owning stdout or command routing. */
export const handleHomeCommand = async (
  input: HomeCommandHandlerInput,
): Promise<HomeCommandResult> => {
  if (input.path[0] !== "home") return { handled: false };
  if (input.path.length !== 1)
    fail("USAGE_ERROR", 2, "The home command takes no arguments.");
  const locale = await input.loadLocale();
  if (!input.interactionAllowed) {
    await input.renderRootHelp();
    return { handled: true };
  }
  input.write(
    renderInteractiveHomeHeader(locale, input.color, input.showWordmark),
  );
  const command = await input
    .interaction()
    .choose(rootMenuChoices(await input.rootHelp(), input.color), {
      pageSize: 100,
      searchable: true,
      commandPath: [],
      ignoreInitialEscape: input.ignoreInitialEscape,
      nextBackPath: ["home"],
    });
  if (command === "help") {
    input.selected();
    await input.renderRootHelp();
    return { handled: true };
  }
  if (command === "version") {
    input.selected();
    input.renderVersion(locale);
    return { handled: true };
  }
  return { handled: true, nextPath: [command] };
};
