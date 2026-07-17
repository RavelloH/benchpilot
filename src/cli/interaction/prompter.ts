import { createInterface } from "node:readline/promises";
import type { Readable, Writable } from "node:stream";
import type { Locale } from "../../i18n/index.js";
import { t } from "../../i18n/index.js";

export interface PromptIO {
  input: Readable;
  output: Writable;
}

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

/** A single readline session for a complete command-selection conversation. */
export class InteractionSession {
  private readonly readline;
  private cancelled = false;
  private closed = false;
  private resolveClosed!: () => void;
  private readonly closedPromise = new Promise<void>((resolve) => {
    this.resolveClosed = resolve;
  });

  constructor(
    private readonly io: PromptIO,
    private readonly locale: Locale,
  ) {
    this.readline = createInterface({
      input: io.input,
      output: io.output,
      terminal: true,
    });
    this.readline.on("SIGINT", () => {
      this.cancelled = true;
      this.readline.close();
    });
    this.readline.once("close", () => {
      this.closed = true;
      this.resolveClosed();
    });
  }

  async choose(choices: readonly PromptChoice[]): Promise<string> {
    if (!choices.length) throw new InteractionCancelledError();
    this.io.output.write(`${t(this.locale, "menu.choose")}:\n`);
    choices.forEach((choice, index) =>
      this.io.output.write(`  ${index + 1}. ${choice.label || choice.value}\n`),
    );
    while (!this.cancelled) {
      const answer = await this.question("> ");
      const byNumber = Number(answer);
      const choice = Number.isInteger(byNumber)
        ? choices[byNumber - 1]
        : choices.find((item) => item.value === answer);
      if (choice) return choice.value;
      this.io.output.write(`${t(this.locale, "menu.invalid")}\n`);
    }
    throw new InteractionCancelledError();
  }

  async value(name: string): Promise<string> {
    const answer = await this.question(
      `${t(this.locale, "menu.value", { name })}: `,
    );
    if (!answer) throw new InteractionCancelledError();
    return answer;
  }

  private async question(question: string): Promise<string> {
    if (this.closed) throw new InteractionCancelledError();
    try {
      const answer = await Promise.race([
        this.readline.question(question),
        this.closedPromise.then(() => undefined),
      ]);
      if (typeof answer !== "string") throw new InteractionCancelledError();
      const trimmed = answer.trim();
      if (this.cancelled || !trimmed) throw new InteractionCancelledError();
      return trimmed;
    } catch (error) {
      if (error instanceof InteractionCancelledError) throw error;
      throw new InteractionCancelledError();
    }
  }

  close() {
    this.readline.close();
  }
}

export async function promptInit(input: {
  io: PromptIO;
  locale: Locale;
  projectId?: string;
  projectName?: string;
  selectedLocale?: Locale;
}): Promise<{ projectId: string; projectName: string; locale: Locale }> {
  const readline = createInterface({
    input: input.io.input,
    output: input.io.output,
    terminal: true,
  });
  try {
    const locale =
      input.selectedLocale ??
      ((
        await readline.question(
          `${t(input.locale, "init.language")} [1] English [2] 简体中文: `,
        )
      ).trim() === "2"
        ? "zh-CN"
        : "en");
    const projectId =
      input.projectId ??
      (await readline.question(`${t(locale, "init.projectId")}: `)).trim();
    const projectName =
      input.projectName ??
      (await readline.question(`${t(locale, "init.projectName")}: `)).trim();
    if (!projectId || !projectName) {
      const error = new Error("INTERACTION_CANCELLED");
      error.name = "INTERACTION_CANCELLED";
      throw error;
    }
    return { projectId, projectName, locale };
  } finally {
    readline.close();
  }
}
