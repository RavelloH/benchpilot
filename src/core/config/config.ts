import { fail } from "../errors/benchpilot-error.js";

export type Json = Record<string, unknown>;
export type ApprovalLevel = "strict" | "default" | "bypass";
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

const approvalLevels = new Set<ApprovalLevel>(["strict", "default", "bypass"]);
const adapterId = /^[a-z][a-z0-9-]*$/;

/**
 * Per-person, per-project policy for deciding which declared safety classes
 * enter the human approval lifecycle.  Capability declarations remain the
 * source of truth for whether an operation is ordinary, dangerous, or
 * approval-sensitive; this setting only selects the approval threshold.
 */
export function approvalLevel(config: Json): ApprovalLevel {
  const value = object(config.approval) ? config.approval.level : undefined;
  return approvalLevels.has(value as ApprovalLevel)
    ? (value as ApprovalLevel)
    : "default";
}

export function requiresApproval(
  level: ApprovalLevel,
  safetyMode: "normal" | "caution" | "destructive" | "irreversible",
) {
  if (level === "bypass" || safetyMode === "normal") return false;
  if (level === "strict") return true;
  return safetyMode === "irreversible";
}

/** Returns the project's explicit adapter allowlist. */
export function enabledAdapterIds(config: Json): string[] {
  const adapters = object(config.adapters) ? config.adapters : undefined;
  const enabled = adapters?.enabled;
  if (
    !Array.isArray(enabled) ||
    !enabled.every((id) => typeof id === "string")
  ) {
    fail(
      "INVALID_ADAPTER_SELECTION",
      3,
      "adapters.enabled must be an array of adapter IDs.",
    );
    return [];
  }
  const ids = enabled as string[];
  if (ids.some((id) => !adapterId.test(id)) || new Set(ids).size !== ids.length)
    fail(
      "INVALID_ADAPTER_SELECTION",
      3,
      "adapters.enabled must contain unique, valid adapter IDs.",
    );
  return [...ids];
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
  if (c.adapters !== undefined && !object(c.adapters))
    fail("INVALID_CONFIG", 3, "adapters must be a table.");
  if (object(c.adapters) && c.adapters.enabled !== undefined)
    enabledAdapterIds(c);
  if (c.approval !== undefined && !object(c.approval))
    fail("INVALID_CONFIG", 3, "approval must be a table.");
  const configuredApproval = c.approval as Json | undefined;
  if (
    configuredApproval?.level !== undefined &&
    !approvalLevels.has(configuredApproval.level as ApprovalLevel)
  )
    fail(
      "INVALID_APPROVAL_LEVEL",
      3,
      "approval.level must be strict, default, or bypass.",
    );
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
    const system = s as Json;
    const members = system.members;
    const validMember = (member: unknown): member is Json =>
      object(member) &&
      typeof member.device === "string" &&
      Boolean(devices[member.device]) &&
      (member.role === undefined || typeof member.role === "string");
    if (
      !/^[a-zA-Z][\w-]*$/.test(id) ||
      !object(s) ||
      !Array.isArray(members) ||
      !members.length ||
      !members.every(validMember) ||
      new Set((members as Json[]).map((member) => String(member.device)))
        .size !== members.length
    )
      fail(
        "INVALID_SYSTEM_CONFIG",
        3,
        `System ${id} references an unknown device.`,
      );
  }
}
