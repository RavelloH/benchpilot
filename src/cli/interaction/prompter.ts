import { createInterface } from "node:readline/promises";
import type { Readable, Writable } from "node:stream";
import type { Locale } from "../../i18n/index.js";
import { t } from "../../i18n/index.js";

export interface PromptIO {
  input: Readable;
  output: Writable;
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
