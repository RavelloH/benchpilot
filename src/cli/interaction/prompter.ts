import prompts from "prompts";
import type { Locale } from "../../i18n/index.js";
import { t } from "../../i18n/index.js";

export interface PromptChoice {
  value: string;
  label?: string;
}

export class InteractionCancelledError extends Error {
  constructor() {
    super("INTERACTION_CANCELLED");
    this.name = "INTERACTION_CANCELLED";
  }
}

/** A continuous prompts session for a complete command-selection conversation. */
export class InteractionSession {
  private cancelled = false;

  constructor(private readonly locale: Locale) {}

  async choose(choices: readonly PromptChoice[]): Promise<string> {
    if (!choices.length) throw new InteractionCancelledError();
    const result = await prompts(
      {
        type: "select",
        name: "value",
        message: t(this.locale, "menu.choose"),
        choices: choices.map((choice) => ({
          title: choice.label || choice.value,
          value: choice.value,
        })),
      },
      {
        onCancel: () => {
          this.cancelled = true;
          return false;
        },
      },
    );
    if (this.cancelled || typeof result.value !== "string")
      throw new InteractionCancelledError();
    return result.value;
  }

  async value(name: string): Promise<string> {
    const result = await prompts(
      {
        type: "text",
        name: "value",
        message: t(this.locale, "menu.value", { name }),
        validate: (value) =>
          String(value).trim() ? true : t(this.locale, "menu.invalid"),
      },
      {
        onCancel: () => {
          this.cancelled = true;
          return false;
        },
      },
    );
    if (this.cancelled || typeof result.value !== "string")
      throw new InteractionCancelledError();
    return result.value.trim();
  }

  close() {}
}

export async function promptInit(input: {
  locale: Locale;
  projectId?: string;
  projectName?: string;
  selectedLocale?: Locale;
}): Promise<{ projectId: string; projectName: string; locale: Locale }> {
  const bootstrap = new InteractionSession(input.locale);
  const locale =
    input.selectedLocale ??
    ((await bootstrap.choose([
      { value: "en", label: "English" },
      { value: "zh-CN", label: "简体中文" },
    ])) as Locale);
  const session = new InteractionSession(locale);
  const projectId =
    input.projectId ?? (await session.value(t(locale, "init.projectId")));
  const projectName =
    input.projectName ?? (await session.value(t(locale, "init.projectName")));
  return { projectId, projectName, locale };
}
