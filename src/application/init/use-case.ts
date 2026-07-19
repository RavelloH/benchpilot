import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import TOML from "@iarna/toml";
import { fail, type Json } from "../../core.js";

/** Persisted locale values; presentation owns their translated catalogs. */
export type ProjectLocale = "en" | "zh-CN";

export interface InitializeProjectInput {
  cwd: string;
  projectId: string;
  projectName: string;
  locale: ProjectLocale;
}

async function exists(file: string) {
  try {
    await fs.access(file);
    return true;
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

/** Creates a target without replacing an existing user-owned file. */
async function writeNewAtomic(file: string, content: string) {
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, content, { encoding: "utf8", flag: "wx" });
    await fs.link(temporary, file);
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => {});
  }
}

/** Creates the minimal project skeleton; presentation and prompts live in CLI. */
export async function initializeProject(
  input: InitializeProjectInput,
): Promise<Json> {
  const config = path.join(input.cwd, "benchpilot.toml");
  if (await exists(config))
    fail(
      "CONFIG_EXISTS",
      3,
      `${config} already exists; refusing to overwrite it.`,
    );
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
  const gitignore = path.join(localDir, ".gitignore");
  if ((await exists(local)) || (await exists(gitignore)))
    fail(
      "INIT_TARGET_EXISTS",
      3,
      `${localDir} already contains initialization files; refusing to overwrite them.`,
    );
  const localDirExisted = await exists(localDir);
  const created: string[] = [];
  await fs.mkdir(localDir, { recursive: true });
  try {
    await writeNewAtomic(
      config,
      TOML.stringify({
        version: 1,
        project: { id: input.projectId, name: input.projectName },
      } as never),
    );
    created.push(config);
    await writeNewAtomic(
      local,
      TOML.stringify({
        cli: { locale: input.locale },
        approval: { level: "default" },
      } as never),
    );
    created.push(local);
    await writeNewAtomic(gitignore, "*\n!.gitignore\n");
    created.push(gitignore);
  } catch (error) {
    await Promise.all(
      created.reverse().map((file) => fs.rm(file, { force: true })),
    );
    if (!localDirExisted) await fs.rmdir(localDir).catch(() => {});
    throw error;
  }
  return {
    created: config,
    project: { id: input.projectId, name: input.projectName },
    locale: input.locale,
  };
}
