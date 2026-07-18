import { promises as fs } from "node:fs";
import path from "node:path";
import TOML from "@iarna/toml";
import { PathService } from "../../core.js";

export type ConfiguredLocale = "en" | "zh-CN";

const isConfiguredLocale = (value: unknown): value is ConfiguredLocale =>
  value === "en" || value === "zh-CN";

/**
 * Reads only the project-local presentation preference. Help must remain
 * available even when unrelated configuration is absent or malformed.
 */
export async function readProjectLocale(input: {
  cwd: string;
  configPath?: string;
  paths?: PathService;
}): Promise<ConfiguredLocale> {
  try {
    const paths = input.paths ?? new PathService();
    const project = await paths.project(input.cwd, input.configPath);
    if (!project) return "en";
    const localConfig = path.join(
      project.root,
      ".benchpilot",
      "config.local.toml",
    );
    const value = TOML.parse(await fs.readFile(localConfig, "utf8")) as {
      cli?: { locale?: unknown };
    };
    return isConfiguredLocale(value.cli?.locale) ? value.cli.locale : "en";
  } catch {
    return "en";
  }
}
