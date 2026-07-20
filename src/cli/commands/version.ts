import { fail } from "../../core.js";
import type { Locale } from "../../i18n/index.js";

export interface VersionCommandHandlerInput {
  readonly path: readonly string[];
  readonly forceVersion: boolean;
  readonly helpRequested: boolean;
  readonly loadLocale: () => Promise<Locale>;
  readonly renderHelp: (target: readonly string[]) => Promise<void>;
  readonly renderVersion: (locale: Locale) => void;
}

/** Handles the version command and global version alias from one definition. */
export const handleVersionCommand = async (
  input: VersionCommandHandlerInput,
) => {
  if (input.forceVersion) {
    if (input.helpRequested) await input.renderHelp(["version"]);
    else input.renderVersion(await input.loadLocale());
    return true;
  }
  if (input.path[0] !== "version") return false;
  if (input.helpRequested) {
    await input.renderHelp(["version"]);
    return true;
  }
  if (input.path.length !== 1)
    fail("USAGE_ERROR", 2, "The version command takes no arguments.");
  input.renderVersion(await input.loadLocale());
  return true;
};
