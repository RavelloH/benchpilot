import { promises as fs } from "node:fs";
import path from "node:path";
import TOML from "@iarna/toml";
import { BenchPilotError, fail, type Json } from "../../core.js";
import type { Locale } from "../../i18n/index.js";

export interface InitializeProjectInput {
  cwd: string;
  projectId: string;
  projectName: string;
  locale: Locale;
}

async function writeAtomic(file: string, content: string) {
  const temporary = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temporary, content, "utf8");
  await fs.rename(temporary, file);
}

/** Creates the minimal project skeleton; presentation and prompts live in CLI. */
export async function initializeProject(
  input: InitializeProjectInput,
): Promise<Json> {
  const config = path.join(input.cwd, "benchpilot.toml");
  try {
    await fs.access(config);
    fail(
      "CONFIG_EXISTS",
      3,
      `${config} already exists; refusing to overwrite it.`,
    );
  } catch (error) {
    if (error instanceof BenchPilotError) throw error;
  }
  if (!/^[a-zA-Z][\w-]*$/.test(input.projectId))
    fail(
      "INVALID_PROJECT_ID",
      2,
      "Project ID must start with a letter and contain only letters, digits, underscores, or hyphens.",
    );
  if (!input.projectName.trim())
    fail("INVALID_PROJECT_NAME", 2, "Project name cannot be empty.");

  const localDir = path.join(input.cwd, ".benchpilot");
  const local = path.join(localDir, "config.local.toml");
  await fs.mkdir(localDir, { recursive: true });
  try {
    await writeAtomic(
      config,
      TOML.stringify({
        version: 1,
        project: { id: input.projectId, name: input.projectName },
      } as never),
    );
    await writeAtomic(
      local,
      TOML.stringify({ cli: { locale: input.locale } } as never),
    );
    await fs.writeFile(
      path.join(localDir, ".gitignore"),
      "*\n!.gitignore\n",
      "utf8",
    );
  } catch (error) {
    await fs.rm(config, { force: true }).catch(() => {});
    throw error;
  }
  return {
    created: config,
    project: { id: input.projectId, name: input.projectName },
    locale: input.locale,
  };
}
