import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import TOML from "@iarna/toml";
import { fail, validateConfig, type Json } from "../../core.js";

export interface InitializeProjectInput {
  cwd: string;
  projectName: string;
  enabledAdapters: readonly string[];
}

export interface InitializeProjectResult {
  readonly created: string;
  /** Whether init adopted an existing project configuration. */
  readonly existing: boolean;
  /** The project configuration now in effect at the project root. */
  readonly config: Json;
  readonly project: {
    readonly id?: string;
    readonly name?: string;
  };
  readonly adapters: {
    readonly enabled: readonly string[];
  };
}

const isObject = (value: unknown): value is Json =>
  !!value && typeof value === "object" && !Array.isArray(value);

const projectSummary = (config: Json) => {
  const project = isObject(config.project) ? config.project : {};
  const adapters = isObject(config.adapters) ? config.adapters : {};
  return {
    project: {
      ...(typeof project.id === "string" ? { id: project.id } : {}),
      ...(typeof project.name === "string" ? { name: project.name } : {}),
    },
    adapters: {
      enabled: Array.isArray(adapters.enabled)
        ? adapters.enabled.filter(
            (adapter): adapter is string => typeof adapter === "string",
          )
        : [],
    },
  };
};

async function readProjectConfig(file: string): Promise<Json> {
  try {
    const parsed = TOML.parse(await fs.readFile(file, "utf8"));
    if (!isObject(parsed))
      fail("INVALID_CONFIG", 3, `${file} must contain a TOML object.`);
    validateConfig(parsed);
    return parsed;
  } catch (error) {
    if (error instanceof Error && "kind" in error) throw error;
    fail(
      "INVALID_TOML",
      3,
      `Cannot parse ${file}: ${(error as Error).message}`,
    );
    throw new Error("unreachable");
  }
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

/** Whether this exact directory already owns a project configuration. */
export const hasProjectConfig = (cwd: string) =>
  exists(path.join(cwd, "benchpilot.toml"));

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
): Promise<InitializeProjectResult> {
  const config = path.join(input.cwd, "benchpilot.toml");
  const localDir = path.join(input.cwd, ".benchpilot");
  const local = path.join(localDir, "config.local.toml");
  const gitignore = path.join(localDir, ".gitignore");

  if (await exists(config)) {
    const current = await readProjectConfig(config);
    await fs.mkdir(localDir, { recursive: true });
    if (!(await exists(local)))
      await writeNewAtomic(
        local,
        TOML.stringify({ approval: { level: "default" } } as never),
      );
    if (!(await exists(gitignore)))
      await writeNewAtomic(gitignore, "*\n!.gitignore\n");
    return {
      created: config,
      existing: true,
      config: current,
      ...projectSummary(current),
    };
  }

  if (!input.projectName.trim())
    fail("INVALID_PROJECT_NAME", 2, "Project name cannot be empty.");
  const projectId = `project-${randomUUID()}`;
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
        project: { id: projectId, name: input.projectName },
        adapters: { enabled: input.enabledAdapters },
      } as never),
    );
    created.push(config);
    await writeNewAtomic(
      local,
      TOML.stringify({
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
    existing: false,
    config: {
      version: 1,
      project: { id: projectId, name: input.projectName },
      adapters: { enabled: [...input.enabledAdapters] },
    },
    project: { id: projectId, name: input.projectName },
    adapters: { enabled: [...input.enabledAdapters] },
  };
}
