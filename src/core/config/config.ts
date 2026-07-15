import { promises as fs } from "node:fs";
import path from "node:path";
import TOML from "@iarna/toml";
import { BenchPilotError, fail } from "../errors/benchpilot-error.js";
import { PathService } from "../paths/path-service.js";
import { sha } from "../utilities/stable-json.js";

export type Json = Record<string, unknown>;
export type Scope =
  | "cli"
  | "environment"
  | "explicit"
  | "project-local"
  | "project"
  | "global"
  | "default";
export interface Origin {
  scope: Scope;
  path?: string;
  environmentVariable?: string;
}
export interface ResolvedConfig {
  value: Json;
  origins: Map<string, Origin>;
  layers: Array<{ scope: Scope; path?: string; value: Json }>;
}

export function projectStorageKey(project: {
  id?: string;
  root?: string;
}): string {
  const prefix =
    String(project.id || "outside-project")
      .replace(/[^a-zA-Z0-9_-]/g, "-")
      .slice(0, 24) || "project";
  return `${prefix}-${sha({ id: project.id || "", root: project.root || "" }).slice(0, 24)}`;
}
const unsafeKey = (key: string) =>
  ["__proto__", "prototype", "constructor"].includes(key);
export function assertSafeKeyPath(key: string) {
  if (!key || key.split(".").some((part) => !part || unsafeKey(part)))
    fail("INVALID_CONFIG", 3, `Unsafe configuration key: ${key}`);
}
function safeObject(value: unknown): Json {
  if (!object(value)) return value as Json;
  const out: Json = Object.create(null) as Json;
  for (const [key, child] of Object.entries(value)) {
    if (unsafeKey(key))
      fail("INVALID_CONFIG", 3, `Unsafe configuration key: ${key}`);
    out[key] = object(child) ? safeObject(child) : child;
  }
  return out;
}
export function redactResolvedConfig(value: Json): Json {
  const sensitive =
    /(?:password|passwd|secret|token|api_?key|private_?key|credential|authorization)/i;
  const redact = (input: unknown, key = ""): unknown => {
    if (sensitive.test(key)) return "[REDACTED]";
    if (Array.isArray(input)) return input.map((item) => redact(item));
    if (object(input))
      return Object.fromEntries(
        Object.entries(input).map(([k, v]) => [k, redact(v, k)]),
      );
    return input;
  };
  return redact(value) as Json;
}
export const duration = (value: unknown, fallback?: number): number => {
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string")
    fail("INVALID_DURATION", 2, "Duration must be like 250ms, 10s, 2m, or 1h.");
  const m = /^(\d+(?:\.\d+)?)(ms|s|m|h)$/.exec(String(value));
  if (!m) fail("INVALID_DURATION", 2, `Invalid duration: ${value}`);
  return (
    Number(m![1]) *
    ({ ms: 1, s: 1000, m: 60000, h: 3600000 } as Record<string, number>)[
      m![2] as string
    ]
  );
};

const object = (x: unknown): x is Json =>
  !!x && typeof x === "object" && !Array.isArray(x);
export const merge = (low: Json, high: Json): Json => {
  const out: Json = safeObject(low);
  for (const [k, v] of Object.entries(high)) {
    if (unsafeKey(k))
      fail("INVALID_CONFIG", 3, `Unsafe configuration key: ${k}`);
    out[k] = object(v) && object(out[k]) ? merge(out[k] as Json, v) : v;
  }
  return out;
};
function leaves(value: unknown, prefix = ""): string[] {
  if (!object(value)) return prefix ? [prefix] : [];
  return Object.entries(value).flatMap(([k, v]) =>
    leaves(v, prefix ? `${prefix}.${k}` : k),
  );
}
function envConfig(env: NodeJS.ProcessEnv): {
  value: Json;
  names: Map<string, string>;
} {
  const value: Json = {},
    names = new Map<string, string>();
  for (const [name, raw] of Object.entries(env))
    if (name.startsWith("BENCHPILOT_") && !["BENCHPILOT_HOME"].includes(name)) {
      const parts = name.slice(12).toLowerCase().split("__");
      if (parts.some(unsafeKey))
        fail(
          "INVALID_CONFIG",
          3,
          `Unsafe configuration environment variable: ${name}`,
        );
      let cur = value;
      for (const p of parts.slice(0, -1)) cur = (cur[p] ||= {}) as Json;
      let parsed: unknown = raw;
      if (raw === "true" || raw === "false") parsed = raw === "true";
      else if (raw && /^-?\d+(\.\d+)?$/.test(raw)) parsed = Number(raw);
      else
        try {
          parsed = JSON.parse(raw!);
        } catch {}
      cur[parts.at(-1)!] = parsed;
      names.set(parts.join("."), name);
    }
  return { value, names };
}
async function toml(file: string): Promise<Json | undefined> {
  try {
    const x = TOML.parse(await fs.readFile(file, "utf8"));
    if (!object(x))
      fail("INVALID_CONFIG", 3, `${file} must contain a TOML object.`);
    return safeObject(x);
  } catch (e: unknown) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    if (e instanceof BenchPilotError) throw e;
    fail("INVALID_TOML", 3, `Cannot parse ${file}: ${(e as Error).message}`);
  }
}
export async function loadConfig(
  paths: PathService,
  project: { root: string; config: string } | undefined,
  explicit?: string,
): Promise<ResolvedConfig> {
  const layers: ResolvedConfig["layers"] = [
    { scope: "default", value: { version: 1, defaults: { timeout: "30s" } } },
  ];
  const add = async (scope: Scope, file?: string) => {
    if (!file) return;
    const value = await toml(file);
    if (value) layers.push({ scope, path: file, value });
  };
  await add("global", paths.globalConfig());
  await add("project", project?.config);
  await add(
    "project-local",
    project && path.join(project.root, ".benchpilot", "config.local.toml"),
  );
  await add("explicit", explicit);
  const ev = envConfig(paths.env);
  if (Object.keys(ev.value).length)
    layers.push({ scope: "environment", value: ev.value });
  let value: Json = {},
    origins = new Map<string, Origin>();
  for (const layer of layers) {
    value = merge(value, layer.value);
    for (const key of leaves(layer.value))
      origins.set(key, {
        scope: layer.scope,
        path: layer.path,
        environmentVariable: ev.names.get(key),
      });
  }
  validateConfig(value);
  return { value, origins, layers };
}
export function getKey(obj: Json, key: string): unknown {
  assertSafeKeyPath(key);
  return key
    .split(".")
    .reduce<unknown>((x, p) => (object(x) ? x[p] : undefined), obj);
}
export function setKey(obj: Json, key: string, value: unknown) {
  assertSafeKeyPath(key);
  const parts = key.split(".");
  let cur = obj;
  for (const p of parts.slice(0, -1)) cur = (cur[p] ||= {}) as Json;
  cur[parts.at(-1)!] = value;
}
export function deleteKey(obj: Json, key: string) {
  assertSafeKeyPath(key);
  const ps = key.split(".");
  let cur: Json | undefined = obj;
  for (const p of ps.slice(0, -1)) {
    const next: unknown = cur?.[p];
    cur = object(next) ? next : undefined;
  }
  if (cur) delete cur[ps.at(-1)!];
}
export function validateConfig(c: Json) {
  safeObject(c);
  if (c.version !== undefined && c.version !== 1)
    fail(
      "UNSUPPORTED_CONFIG_VERSION",
      3,
      "Only config version = 1 is supported.",
    );
  if (c.devices !== undefined && !object(c.devices))
    fail("INVALID_CONFIG", 3, "devices must be a table.");
  const devices = (c.devices || {}) as Json;
  for (const [id, raw] of Object.entries(devices)) {
    const d = raw as Json;
    if (
      !/^[a-zA-Z][\w-]*$/.test(id) ||
      !object(d) ||
      typeof d.adapter !== "string"
    )
      fail("INVALID_DEVICE_CONFIG", 3, `Device ${id} requires an adapter.`);
  }
  for (const [id, s] of Object.entries((c.systems || {}) as Json)) {
    if (
      !object(s) ||
      !Array.isArray(s.devices) ||
      s.devices.some((x) => typeof x !== "string" || !devices[x])
    )
      fail(
        "INVALID_SYSTEM_CONFIG",
        3,
        `System ${id} references an unknown device.`,
      );
  }
}
