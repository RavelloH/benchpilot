import { promises as fs } from "node:fs";
import path from "node:path";
import TOML from "@iarna/toml";
import {
  BenchPilotError,
  deleteKey,
  fail,
  getKey,
  setKey,
  type Json,
  type PathService,
  validateConfig,
} from "../../core.js";
import type { Flags } from "../parser.js";

export async function editConfig(
  paths: PathService,
  project: Awaited<ReturnType<PathService["project"]>>,
  flags: Flags,
  key: string,
  value?: string,
): Promise<Json> {
  const scopes = ["local", "project", "global"].filter(
    (scope) => flags[scope],
  ) as string[];
  if (scopes.length > 1)
    fail("USAGE_ERROR", 2, "Choose only one configuration scope.");
  const scope = scopes[0] || (project ? "local" : "global");
  const file =
    scope === "local"
      ? project && path.join(project.root, ".benchpilot", "config.local.toml")
      : scope === "project"
        ? project?.config
        : paths.globalConfig();
  const targetFile = file || "";
  if (!targetFile) {
    fail("PROJECT_NOT_FOUND", 3, "--project requires a BenchPilot project.");
  }
  let config: Json = {};
  try {
    config = TOML.parse(await fs.readFile(targetFile, "utf8")) as Json;
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if (value === undefined) deleteKey(config, key);
  else {
    let parsed: unknown = value;
    if (value === "true" || value === "false") parsed = value === "true";
    else if (/^-?\d+(\.\d+)?$/.test(value)) parsed = Number(value);
    else
      try {
        parsed = JSON.parse(value);
      } catch {}
    setKey(config, key, parsed);
  }
  validateConfig(config);
  await fs.mkdir(path.dirname(targetFile), { recursive: true });
  const temporary = `${targetFile}.${process.pid}.tmp`;
  await fs.writeFile(temporary, TOML.stringify(config as never));
  await fs.rename(temporary, targetFile);
  return {
    scope,
    path: targetFile,
    key,
    value: value === undefined ? undefined : getKey(config, key),
  };
}
