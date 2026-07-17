import { promises as fs } from "node:fs";
import path from "node:path";
import TOML from "@iarna/toml";
import {
  deleteKey,
  fail,
  getKey,
  setKey,
  type Json,
  type PathService,
  validateConfig,
} from "../../core.js";

export interface EditConfigInput {
  paths: PathService;
  project: Awaited<ReturnType<PathService["project"]>>;
  scope?: "local" | "project" | "global";
  key: string;
  value?: string;
}

export interface ConfigurationUseCaseDependencies {
  paths: PathService;
  project: Awaited<ReturnType<PathService["project"]>>;
}

/** Request-scoped configuration mutations without CLI flag dependencies. */
export class ConfigurationUseCases {
  constructor(
    private readonly dependencies: ConfigurationUseCaseDependencies,
  ) {}

  async edit(input: {
    scopes: Array<"local" | "project" | "global">;
    key: string;
    value?: string;
  }) {
    if (input.scopes.length > 1)
      fail("USAGE_ERROR", 2, "Choose only one configuration scope.");
    return editConfiguration({
      paths: this.dependencies.paths,
      project: this.dependencies.project,
      scope: input.scopes[0],
      key: input.key,
      value: input.value,
    });
  }
}

export const createConfigurationUseCases = (
  dependencies: ConfigurationUseCaseDependencies,
) => new ConfigurationUseCases(dependencies);

/** Mutates a declared configuration scope without CLI or terminal dependencies. */
export async function editConfiguration(input: EditConfigInput): Promise<Json> {
  const scope = input.scope || (input.project ? "local" : "global");
  const file =
    scope === "local"
      ? input.project &&
        path.join(input.project.root, ".benchpilot", "config.local.toml")
      : scope === "project"
        ? input.project?.config
        : input.paths.globalConfig();
  if (typeof file !== "string")
    fail("PROJECT_NOT_FOUND", 3, "--project requires a BenchPilot project.");
  const targetFile = file as string;
  let config: Json = {};
  try {
    config = TOML.parse(await fs.readFile(targetFile, "utf8")) as Json;
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if (input.value === undefined) deleteKey(config, input.key);
  else {
    let parsed: unknown = input.value;
    if (input.value === "true" || input.value === "false")
      parsed = input.value === "true";
    else if (/^-?\d+(\.\d+)?$/.test(input.value)) parsed = Number(input.value);
    else
      try {
        parsed = JSON.parse(input.value);
      } catch {}
    setKey(config, input.key, parsed);
  }
  validateConfig(config);
  await fs.mkdir(path.dirname(targetFile), { recursive: true });
  const temporary = `${targetFile}.${process.pid}.tmp`;
  await fs.writeFile(temporary, TOML.stringify(config as never));
  await fs.rename(temporary, targetFile);
  return {
    scope,
    path: targetFile,
    key: input.key,
    value: input.value === undefined ? undefined : getKey(config, input.key),
  };
}
