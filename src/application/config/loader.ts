import { promises as fs } from "node:fs";
import path from "node:path";
import TOML from "@iarna/toml";
import {
  BenchPilotError,
  fail,
  merge,
  type Origin,
  type PathService,
  type ResolvedConfig,
  type Scope,
  type Json,
  validateConfig,
} from "../../core.js";

const object = (value: unknown): value is Json =>
  !!value && typeof value === "object" && !Array.isArray(value);
const unsafeKey = (key: string) =>
  ["__proto__", "prototype", "constructor"].includes(key);
const leaves = (value: unknown, prefix = ""): string[] => {
  if (!object(value)) return prefix ? [prefix] : [];
  return Object.entries(value).flatMap(([key, child]) =>
    leaves(child, prefix ? `${prefix}.${key}` : key),
  );
};

const environmentLayer = (env: NodeJS.ProcessEnv) => {
  const value: Json = {},
    names = new Map<string, string>();
  for (const [name, raw] of Object.entries(env)) {
    if (!name.startsWith("BENCHPILOT_")) continue;
    const parts = name.slice("BENCHPILOT_".length).toLowerCase().split("__");
    if (parts.some(unsafeKey))
      fail(
        "INVALID_CONFIG",
        3,
        `Unsafe configuration environment variable: ${name}`,
      );
    let current = value;
    for (const part of parts.slice(0, -1))
      current = (current[part] ||= {}) as Json;
    let parsed: unknown = raw;
    if (raw === "true" || raw === "false") parsed = raw === "true";
    else if (raw && /^-?\d+(\.\d+)?$/.test(raw)) parsed = Number(raw);
    else
      try {
        parsed = JSON.parse(raw ?? "");
      } catch {}
    current[parts.at(-1)!] = parsed;
    names.set(parts.join("."), name);
  }
  return { value, names };
};

const readToml = async (file: string): Promise<Json | undefined> => {
  try {
    const value = TOML.parse(await fs.readFile(file, "utf8"));
    if (!object(value))
      fail("INVALID_CONFIG", 3, `${file} must contain a TOML object.`);
    return value;
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    if (error instanceof BenchPilotError) throw error;
    fail(
      "INVALID_TOML",
      3,
      `Cannot parse ${file}: ${(error as Error).message}`,
    );
  }
};

/** Application-owned configuration I/O and TOML parsing. */
export async function loadApplicationConfig(
  paths: PathService,
  project: { root: string; config: string } | undefined,
  explicit?: string,
): Promise<ResolvedConfig> {
  const layers: ResolvedConfig["layers"] = [
    {
      scope: "default",
      value: {
        version: 1,
        defaults: { timeout: "30s" },
        adapters: { enabled: [] },
        approval: { level: "default" },
      },
    },
  ];
  const add = async (scope: Scope, file?: string) => {
    if (!file) return;
    const value = await readToml(file);
    if (value) layers.push({ scope, path: file, value });
  };
  await add("global", paths.globalConfig());
  await add("project", project?.config);
  await add(
    "project-local",
    project && path.join(project.root, ".benchpilot", "config.local.toml"),
  );
  await add("explicit", explicit);
  const environment = environmentLayer(paths.env);
  if (Object.keys(environment.value).length)
    layers.push({ scope: "environment", value: environment.value });
  let value: Json = {},
    origins = new Map<string, Origin>();
  for (const layer of layers) {
    value = merge(value, layer.value);
    for (const key of leaves(layer.value))
      origins.set(key, {
        scope: layer.scope,
        path: layer.path,
        environmentVariable: environment.names.get(key),
      });
  }
  validateConfig(value);
  return { value, origins, layers };
}
