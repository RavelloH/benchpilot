import { PathService } from "../../core.js";
import { loadApplicationConfig } from "./loader.js";
import { editConfiguration } from "./use-case.js";

export type ConfiguredLocale = "en" | "zh-CN";

const isConfiguredLocale = (value: unknown): value is ConfiguredLocale =>
  value === "en" || value === "zh-CN";

const globalLocale = (
  layers: Awaited<ReturnType<typeof loadApplicationConfig>>["layers"],
) => {
  const global = layers.find((layer) => layer.scope === "global")?.value;
  const cli = global?.cli as { locale?: unknown } | undefined;
  return isConfiguredLocale(cli?.locale) ? cli.locale : undefined;
};

/** The CLI language is a personal global preference, never a project setting. */
export async function readGlobalLocaleSetting(
  input: {
    paths?: PathService;
  } = {},
): Promise<ConfiguredLocale | undefined> {
  try {
    const paths = input.paths ?? new PathService();
    return globalLocale((await loadApplicationConfig(paths, undefined)).layers);
  } catch {
    return undefined;
  }
}

export async function readGlobalLocale(
  input: {
    paths?: PathService;
  } = {},
): Promise<ConfiguredLocale> {
  return (await readGlobalLocaleSetting(input)) ?? "en";
}

/** Persists the bootstrap selection as the user's global CLI preference. */
export async function writeGlobalLocale(input: {
  locale: ConfiguredLocale;
  paths?: PathService;
}) {
  const paths = input.paths ?? new PathService();
  return editConfiguration({
    paths,
    project: undefined,
    scope: "global",
    key: "cli.locale",
    value: input.locale,
  });
}
