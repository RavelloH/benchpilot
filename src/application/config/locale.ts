import { PathService } from "../../core.js";
import { loadApplicationConfig } from "./loader.js";

export type ConfiguredLocale = "en" | "zh-CN";

const isConfiguredLocale = (value: unknown): value is ConfiguredLocale =>
  value === "en" || value === "zh-CN";

/**
 * Resolves the presentation preference through the normal configuration
 * precedence, including the global CLI setting. Help remains available when
 * configuration is absent or malformed.
 */
export async function readProjectLocale(input: {
  cwd: string;
  configPath?: string;
  paths?: PathService;
}): Promise<ConfiguredLocale> {
  try {
    const paths = input.paths ?? new PathService();
    const project = await paths.project(input.cwd, input.configPath);
    const config = await loadApplicationConfig(
      paths,
      project,
      input.configPath,
    );
    const cli = config.value.cli as { locale?: unknown } | undefined;
    return isConfiguredLocale(cli?.locale) ? cli.locale : "en";
  } catch {
    return "en";
  }
}
