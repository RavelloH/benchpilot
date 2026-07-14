import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import TOML from "@iarna/toml";
import RlogModule from "rlog-js";
import { BenchPilotError, fail } from "./core/errors/benchpilot-error.js";
import type { RuntimeSchema } from "./core/adapters/schemas.js";
import { lockIdentity } from "./core/locks/lock-identity.js";
import { PathService } from "./core/paths/path-service.js";
import { atomicJson, readJson } from "./core/utilities/atomic-json.js";
import { sha, stable } from "./core/utilities/stable-json.js";
import { resolveInside } from "./core/utilities/resolve-inside.js";
import { RunManager } from "./core/runs/run-manager.js";
import type { ArtifactRecord, Run } from "./core/runs/run-manager.js";
const Rlog = RlogModule.default;

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

export { BenchPilotError, fail } from "./core/errors/benchpilot-error.js";
export {
  arraySchema,
  booleanSchema,
  durationSchema,
  enumSchema,
  numberSchema,
  objectSchema,
  optional,
  stringSchema,
} from "./core/adapters/schemas.js";
export type { RuntimeSchema } from "./core/adapters/schemas.js";
export {
  lockIdentity,
  type PhysicalResourceIdentity,
} from "./core/locks/lock-identity.js";
export { PathService } from "./core/paths/path-service.js";
export { atomicJson, readJson } from "./core/utilities/atomic-json.js";
export { sha, stable } from "./core/utilities/stable-json.js";
export { resolveInside } from "./core/utilities/resolve-inside.js";
export {
  RunManager,
  RUN_ID_PATTERN,
  type ArtifactRecord,
  type Run,
} from "./core/runs/run-manager.js";
const LOCK_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;
const APPROVAL_ID_PATTERN = /^approval-[a-f0-9]+$/;
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

export interface Safety {
  mode: "normal" | "danger-flag" | "human-approval";
  flag?: string;
  effects?: string[];
  approvalTtlMs?: number;
}
export interface OptionDefinition {
  name: string;
  summary: string;
  required?: boolean;
  schema?: RuntimeSchema<unknown>;
}
export interface Capability {
  id: string;
  summary: string;
  description?: string;
  options?: OptionDefinition[];
  inputSchema?: RuntimeSchema<Json>;
  outputSchema?: RuntimeSchema<Json>;
  defaultTimeoutMs: number;
  lockMode: "none" | "exclusive";
  createsRun: boolean;
  safety: Safety;
  execute(ctx: OperationContext, input: Json): Promise<Json>;
}
export interface DeviceRuntime {
  identity: { instance: string; physicalId: string; adapter: string };
  capabilities(): Capability[];
}
export interface Adapter {
  id: string;
  apiVersion?: 1;
  version: string;
  summary: string;
  description?: string;
  configSchema?: RuntimeSchema<unknown>;
  discover(config: Json): Promise<Json[]>;
  doctor(config: Json): Promise<Json[]>;
  createDevice(instance: string, config: Json): Promise<DeviceRuntime>;
}
export class AdapterRegistry {
  private adapters = new Map<string, Adapter>();
  register(a: Adapter) {
    if (this.adapters.has(a.id))
      fail("DUPLICATE_ADAPTER", 8, `Adapter already registered: ${a.id}`);
    this.adapters.set(a.id, a);
  }
  get(id: string): Adapter {
    const a = this.adapters.get(id);
    if (!a) fail("UNKNOWN_ADAPTER", 3, `Unknown adapter: ${id}`);
    return a!;
  }
  list() {
    return [...this.adapters.values()];
  }
}

export interface LockRecord {
  schema: string;
  version: number;
  lockId: string;
  ownerToken: string;
  pid: number;
  hostname: string;
  session?: string;
  command: string;
  runId?: string;
  acquiredAt: string;
  heartbeatAt: string;
  expiresAt: string;
}
export type LockLiveness = "active" | "stale" | "unknown";
export interface LockLease {
  readonly lock: LockRecord;
  readonly lost: Promise<never>;
  stop(): Promise<void>;
}
export class LockManager {
  constructor(private paths: PathService) {}
  file(id: string) {
    if (!LOCK_ID_PATTERN.test(id))
      fail("INVALID_LOCK_ID", 2, `Invalid lock ID: ${id}`);
    return resolveInside(this.paths.runtimeRoot(), `${id}.json`);
  }
  async acquire(
    id: string,
    command: string,
    runId?: string,
  ): Promise<LockRecord> {
    await fs.mkdir(this.paths.runtimeRoot(), { recursive: true });
    const now = new Date(),
      record: LockRecord = {
        schema: "benchpilot.lock",
        version: 1,
        lockId: id,
        ownerToken: randomBytes(16).toString("hex"),
        pid: process.pid,
        hostname: os.hostname(),
        command,
        runId,
        acquiredAt: now.toISOString(),
        heartbeatAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + 30000).toISOString(),
      };
    try {
      const h = await fs.open(this.file(id), "wx");
      await h.writeFile(JSON.stringify(record, null, 2));
      await h.close();
      return record;
    } catch (e: unknown) {
      if ((e as NodeJS.ErrnoException).code === "EEXIST") {
        const held = await readJson<LockRecord>(this.file(id));
        fail("DEVICE_BUSY", 4, `Resource ${id} is locked.`, { holder: held });
      }
      throw e;
    }
  }
  async heartbeat(lock: LockRecord, leaseMs = 30_000): Promise<LockRecord> {
    const existing = await readJson<LockRecord>(this.file(lock.lockId));
    if (!existing || existing.ownerToken !== lock.ownerToken)
      fail("LOCK_OWNERSHIP_LOST", 4, `Lock ownership lost: ${lock.lockId}`);
    const now = new Date();
    const updated: LockRecord = {
      ...existing!,
      heartbeatAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + leaseMs).toISOString(),
    };
    await atomicJson(this.file(lock.lockId), updated);
    return updated;
  }
  startHeartbeat(
    lock: LockRecord,
    intervalMs = 5_000,
    leaseMs = 30_000,
  ): LockLease {
    let stopped = false;
    let wake: (() => void) | undefined;
    let rejectLost!: (error: BenchPilotError) => void;
    const lost = new Promise<never>((_, reject) => {
      rejectLost = reject;
    });
    // The runner consumes this promise; avoid an unhandled rejection if it stops first.
    void lost.catch(() => {});
    const sleep = () =>
      new Promise<void>((resolve) => {
        wake = resolve;
        const timer = setTimeout(resolve, intervalMs);
        timer.unref();
      });
    const loop = (async () => {
      while (!stopped) {
        await sleep();
        wake = undefined;
        if (stopped) break;
        try {
          await this.heartbeat(lock, leaseMs);
        } catch (error) {
          stopped = true;
          rejectLost(
            error instanceof BenchPilotError
              ? error
              : new BenchPilotError(
                  "LOCK_OWNERSHIP_LOST",
                  4,
                  "Lock heartbeat failed.",
                ),
          );
        }
      }
    })();
    return {
      lock,
      lost,
      async stop() {
        stopped = true;
        wake?.();
        await loop;
      },
    };
  }
  async liveness(lock: LockRecord, now = Date.now()): Promise<LockLiveness> {
    const heartbeat = Date.parse(lock.heartbeatAt);
    const expiry = Date.parse(lock.expiresAt);
    const severelyExpired = now > expiry + 10_000;
    if (lock.hostname !== os.hostname())
      return severelyExpired ? "stale" : "unknown";
    if (now > expiry + 10_000) return "stale";
    try {
      process.kill(lock.pid, 0);
      return Number.isFinite(heartbeat) ? "active" : "unknown";
    } catch (error: unknown) {
      return (error as NodeJS.ErrnoException).code === "ESRCH"
        ? "stale"
        : "unknown";
    }
  }
  async release(lock: LockRecord) {
    const existing = await readJson<LockRecord>(this.file(lock.lockId));
    if (!existing) return;
    if (existing.ownerToken !== lock.ownerToken)
      fail("LOCK_OWNERSHIP_LOST", 4, `Lock ownership lost: ${lock.lockId}`);
    await fs.unlink(this.file(lock.lockId));
  }
  async list() {
    try {
      return await Promise.all(
        (await fs.readdir(this.paths.runtimeRoot()))
          .filter((f) => f.endsWith(".json"))
          .map((f) =>
            readJson<LockRecord>(path.join(this.paths.runtimeRoot(), f)),
          ),
      );
    } catch (e: unknown) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw e;
    }
  }
  async clear(id: string, dangerous: boolean) {
    const l = await readJson<LockRecord>(this.file(id));
    if (!l) fail("LOCK_NOT_FOUND", 3, `Lock not found: ${id}`);
    const status = await this.liveness(l!);
    if (status !== "stale" && !dangerous)
      fail(
        "DANGEROUS_CONFIRMATION_REQUIRED",
        7,
        "Active lock requires --dangerously-clear-active-lock.",
      );
    const current = await readJson<LockRecord>(this.file(id));
    if (current?.ownerToken !== l!.ownerToken)
      fail("LOCK_OWNERSHIP_LOST", 4, `Lock changed while clearing: ${id}`);
    await fs.unlink(this.file(id));
    return l;
  }
}

export class ApprovalManager {
  constructor(private paths: PathService) {}
  private assertId(id: string) {
    if (!APPROVAL_ID_PATTERN.test(id))
      fail("INVALID_APPROVAL_ID", 2, `Invalid approval ID: ${id}`);
  }
  private file(id: string) {
    this.assertId(id);
    return resolveInside(this.paths.approvalsRoot(), `${id}.json`);
  }
  async request(binding: Json, ttl = 3600000) {
    await fs.mkdir(this.paths.approvalsRoot(), { recursive: true });
    const id = `approval-${randomBytes(5).toString("hex")}`,
      digest = sha(binding),
      record = {
        schema: "benchpilot.approval",
        version: 1,
        id,
        digest,
        binding,
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + ttl).toISOString(),
        status: "pending",
      };
    await atomicJson(this.file(id), record);
    return record;
  }
  async list() {
    try {
      return (await fs.readdir(this.paths.approvalsRoot()))
        .filter((x) => x.endsWith(".json"))
        .map(async (x) =>
          readJson<Json>(path.join(this.paths.approvalsRoot(), x)),
        );
    } catch (e: unknown) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw e;
    }
  }
  async get(id: string): Promise<Json> {
    const x = await readJson<Json>(this.file(id));
    if (!x) fail("APPROVAL_NOT_FOUND", 3, `Approval not found: ${id}`);
    return x!;
  }
  async change(id: string, status: "approved" | "rejected") {
    this.assertId(id);
    const guard = resolveInside(this.paths.approvalsRoot(), `${id}.change`);
    await fs.mkdir(this.paths.approvalsRoot(), { recursive: true });
    let handle;
    try {
      handle = await fs.open(guard, "wx");
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST")
        fail("APPROVAL_STATE_INVALID", 7, `Approval ${id} is being changed.`);
      throw error;
    }
    try {
      const x = await this.get(id);
      if (x.status !== "pending")
        fail("APPROVAL_STATE_INVALID", 7, `Approval ${id} is not pending.`);
      if (Date.parse(String(x.expiresAt)) <= Date.now())
        fail("APPROVAL_EXPIRED", 7, `Approval ${id} has expired.`);
      await atomicJson(this.file(id), {
        ...x,
        status,
        changedAt: new Date().toISOString(),
      });
    } finally {
      await handle.close().catch(() => {});
      await fs.unlink(guard).catch(() => {});
    }
  }
  private claimFile(id: string) {
    this.assertId(id);
    return resolveInside(this.paths.approvalsRoot(), `${id}.claim`);
  }
  async findMatchingApproval(binding: Json): Promise<Json | undefined> {
    const digest = sha(binding);
    for (const record of await Promise.all(await this.list()))
      if (
        record?.status === "approved" &&
        record.digest === digest &&
        Date.parse(String(record.expiresAt)) > Date.now()
      )
        return record;
    return undefined;
  }
  approvalLiveness(record: Json): "active" | "stale" | "unknown" {
    if (record.status !== "claimed") return "unknown";
    const expiresAt = Date.parse(String(record.claimExpiresAt || ""));
    if (Number.isFinite(expiresAt) && expiresAt <= Date.now()) return "stale";
    const owner = String(record.claimedBy || "");
    const [hostname, pidText] = owner.split(":");
    if (hostname !== os.hostname() || !/^\d+$/.test(pidText || ""))
      return "unknown";
    try {
      process.kill(Number(pidText), 0);
      return "active";
    } catch (error: unknown) {
      return (error as NodeJS.ErrnoException).code === "ESRCH"
        ? "stale"
        : "unknown";
    }
  }
  async claim(binding: Json) {
    const digest = sha(binding);
    for (const candidate of await Promise.all(await this.list())) {
      const record = candidate as Json;
      if (
        record.status === "claimed" &&
        this.approvalLiveness(record) === "stale"
      ) {
        await atomicJson(this.file(String(record.id)), {
          ...record,
          status: "approved",
          releasedAt: new Date().toISOString(),
          claimedBy: undefined,
          claimedAt: undefined,
          claimExpiresAt: undefined,
          claimToken: undefined,
        });
        await fs.unlink(this.claimFile(String(record.id))).catch(() => {});
      }
      const refreshed =
        record.status === "claimed"
          ? await this.get(String(record.id))
          : record;
      if (refreshed.status !== "approved" || refreshed.digest !== digest)
        continue;
      if (Date.parse(String(refreshed.expiresAt)) <= Date.now()) continue;
      const claimToken = randomBytes(16).toString("hex");
      let keepGuard = false;
      try {
        const handle = await fs.open(this.claimFile(String(record.id)), "wx");
        await handle.writeFile(
          JSON.stringify({
            claimToken,
            pid: process.pid,
            claimedAt: new Date().toISOString(),
          }),
        );
        await handle.close();
      } catch (error: unknown) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST") continue;
        throw error;
      }
      try {
        const current = await this.get(String(record.id));
        if (current.status !== "approved" || current.digest !== digest)
          continue;
        const claimed = {
          ...current,
          status: "claimed",
          claimedBy: `${os.hostname()}:${process.pid}`,
          claimedAt: new Date().toISOString(),
          claimExpiresAt: new Date(Date.now() + 300_000).toISOString(),
          claimToken,
        };
        await atomicJson(this.file(String(record.id)), claimed);
        keepGuard = true;
        return claimed;
      } finally {
        if (!keepGuard)
          await fs.unlink(this.claimFile(String(record.id))).catch(() => {});
      }
    }
    return undefined;
  }
  async consumeClaim(record: Json) {
    const current = await this.get(String(record.id));
    if (
      current.status !== "claimed" ||
      current.claimToken !== record.claimToken
    )
      fail(
        "APPROVAL_ALREADY_CLAIMED",
        7,
        `Approval ${record.id} is no longer claimed by this operation.`,
      );
    await atomicJson(this.file(String(record.id)), {
      ...current,
      status: "consumed",
      consumedAt: new Date().toISOString(),
    });
    await fs.unlink(this.claimFile(String(record.id))).catch(() => {});
  }
  async releaseClaim(record: Json) {
    const current = await this.get(String(record.id));
    if (
      current.status === "claimed" &&
      current.claimToken === record.claimToken
    )
      await atomicJson(this.file(String(record.id)), {
        ...current,
        status: "approved",
        claimedBy: undefined,
        claimedAt: undefined,
        claimToken: undefined,
        claimExpiresAt: undefined,
      });
    await fs.unlink(this.claimFile(String(record.id))).catch(() => {});
  }
  async consume(binding: Json) {
    const claim = await this.claim(binding);
    if (!claim) return false;
    await this.consumeClaim(claim);
    return true;
  }
}

export interface OperationContext {
  signal: AbortSignal;
  logger: InstanceType<typeof Rlog>;
  run?: Run;
  stateRoot: string;
  config: Json;
  device: DeviceRuntime;
  registerCleanup(
    name: string,
    handler: () => Promise<void> | void,
    options?: { critical?: boolean },
  ): void;
  markDangerousEffectStarted(): void;
  registerArtifact(record: ArtifactRecord): void;
}
export interface OperationServices {
  paths: PathService;
  registry: AdapterRegistry;
  config: ResolvedConfig;
  project: { root: string; config: string } | undefined;
  flags: Json;
}
export class OperationRunner {
  constructor(private s: OperationServices) {}
  async execute(
    instance: string,
    capabilityId: string,
    input: Json,
  ): Promise<Json> {
    const raw = (this.s.config.value.devices as Json | undefined)?.[instance];
    if (!object(raw))
      fail("DEVICE_NOT_FOUND", 3, `Device not found: ${instance}`);
    const d = raw as Json;
    const runtime = await this.s.registry
      .get(String(d.adapter))
      .createDevice(instance, d);
    const cap = runtime.capabilities().find((x) => x.id === capabilityId);
    if (!cap)
      fail(
        "UNSUPPORTED_CAPABILITY",
        3,
        `Device ${instance} does not support ${capabilityId}.`,
      );
    const capability = cap!;
    const definedOptions = capability.options || [];
    const allowedOptions = new Set(definedOptions.map((option) => option.name));
    for (const name of Object.keys(input))
      if (!allowedOptions.has(name))
        fail(
          "INVALID_CAPABILITY_INPUT",
          2,
          `Unknown option for ${capability.id}: ${name}.`,
        );
    for (const option of definedOptions) {
      if (option.required && input[option.name] === undefined)
        fail(
          "INVALID_CAPABILITY_INPUT",
          2,
          `Missing required option: ${option.name}.`,
        );
      if (input[option.name] !== undefined && option.schema)
        input[option.name] = option.schema.parse(input[option.name]);
    }
    try {
      input = capability.inputSchema?.parse(input) ?? input;
    } catch (error) {
      if (error instanceof BenchPilotError) throw error;
      fail("INVALID_CAPABILITY_INPUT", 2, (error as Error).message);
    }
    const command = `device.${capabilityId}`,
      lockId = lockIdentity({
        adapter: runtime.identity.adapter,
        kind: "device",
        physicalId: runtime.identity.physicalId,
      });
    const safety = capability.safety;
    if (safety.mode !== "normal" && !this.s.flags[safety.flag!])
      fail(
        "DANGEROUS_CONFIRMATION_REQUIRED",
        7,
        `This operation requires --${safety.flag}.`,
      );
    const binding = {
      command,
      device: runtime.identity,
      input,
      project:
        (this.s.config.value.project as Json | undefined)?.id ||
        "outside-project",
      configDigest: sha(this.s.config.value),
    };
    const timeout = duration(this.s.flags.timeout, capability.defaultTimeoutMs);
    if (this.s.flags["dry-run"])
      return {
        dryRun: true,
        device: runtime.identity,
        capability: capability.id,
        lockId,
        lockMode: capability.lockMode,
        timeoutMs: timeout,
        safety,
        approvalRequired: safety.mode === "human-approval",
      };
    if (safety.mode === "human-approval") {
      const existing = await new ApprovalManager(
        this.s.paths,
      ).findMatchingApproval(binding);
      if (!existing) {
        const req = await new ApprovalManager(this.s.paths).request(
          binding,
          safety.approvalTtlMs,
        );
        fail(
          "HUMAN_APPROVAL_REQUIRED",
          7,
          "Human approval is required before this operation can run.",
          { approvalId: req.id },
        );
      }
    }
    const projectKey = projectStorageKey({
      id: String((this.s.config.value.project as Json | undefined)?.id || ""),
      root: this.s.project?.root,
    });
    const runManager = new RunManager(this.s.paths, projectKey);
    const run = capability.createsRun
      ? await new RunManager(this.s.paths, projectKey).create(command, {
          device: runtime.identity,
          adapter: d.adapter,
          adapterVersion: this.s.registry.get(String(d.adapter)).version,
          capability: capability.id,
          physicalIdentity: runtime.identity,
          configDigest: sha(this.s.config.value),
          configSources: this.s.config.layers.map((layer) => ({
            scope: layer.scope,
            path: layer.path,
          })),
          benchpilotVersion: "0.0.0",
          nodeVersion: process.version,
        })
      : undefined;
    if (run)
      await atomicJson(
        path.join(run.dir, "resolved-config.json"),
        redactResolvedConfig(this.s.config.value),
      );
    const logger = new Rlog({
      logFilePath: run && path.join(run.dir, "benchpilot.log"),
      jsonlFilePath: run && path.join(run.dir, "events.jsonl"),
      jsonlOutput: "none",
      screenOutput: this.s.flags.quiet ? "none" : "stderr",
      enableColorfulOutput: !this.s.flags["no-color"],
      screenLogLevel: this.s.flags.verbose ? "debug" : "info",
      context: {
        runId: run?.id,
        command,
        device: instance,
        adapter: d.adapter,
      },
      fileErrorPolicy: "throw",
    });
    let lock: LockRecord | undefined;
    let lease: LockLease | undefined;
    let claimedApproval: Json | undefined;
    const cleanups: Array<{
      name: string;
      critical: boolean;
      handler: () => Promise<void> | void;
    }> = [];
    const cleanupErrors: Json[] = [];
    const artifacts: Json[] = [];
    let dangerousEffectStarted = false;
    const controller = new AbortController();
    let abortReason: "timeout" | "signal" | undefined;
    const timer = setTimeout(() => {
      abortReason = "timeout";
      controller.abort({ kind: "timeout", timeoutMs: timeout });
    }, timeout);
    const onSignal = () => {
      abortReason = "signal";
      controller.abort({ kind: "signal" });
    };
    process.once("SIGINT", onSignal);
    process.once("SIGTERM", onSignal);
    const started = Date.now();
    let data: Json | undefined;
    let primaryError: BenchPilotError | undefined;
    try {
      logger.event("operation.started", { command });
      if (capability.lockMode === "exclusive") {
        logger.event("lock.acquiring", { lockId });
        lock = await new LockManager(this.s.paths).acquire(
          lockId,
          command,
          run?.id,
        );
        lease = new LockManager(this.s.paths).startHeartbeat(lock);
        logger.event("lock.acquired", { lockId });
      }
      if (safety.mode === "human-approval") {
        claimedApproval = await new ApprovalManager(this.s.paths).claim(
          binding,
        );
        if (!claimedApproval)
          fail(
            "APPROVAL_ALREADY_CLAIMED",
            7,
            "Matching approval is no longer available.",
          );
      }
      logger.event("stage.started", { stage: capability.id });
      const execution = capability.execute(
        {
          signal: controller.signal,
          logger,
          run,
          stateRoot: this.s.paths.stateRoot(),
          config: this.s.config.value,
          device: runtime,
          registerCleanup(name, handler, options) {
            cleanups.push({
              name,
              handler,
              critical: options?.critical ?? true,
            });
          },
          markDangerousEffectStarted() {
            dangerousEffectStarted = true;
          },
          registerArtifact(record) {
            if (!run) fail("INVALID_ARTIFACT", 5, "Artifacts require a Run.");
            const artifactRoot = path.join(run!.dir, "artifacts");
            const absolute = resolveInside(artifactRoot, record.path);
            if (absolute !== path.resolve(record.path))
              fail(
                "INVALID_ARTIFACT",
                5,
                "Artifact path must be inside the Run artifacts directory.",
              );
            artifacts.push({
              ...record,
              path: path.relative(run!.dir, absolute),
            });
          },
        },
        input,
      );
      data = await Promise.race([
        execution,
        new Promise<never>((_, reject) =>
          controller.signal.addEventListener(
            "abort",
            () =>
              reject(
                new BenchPilotError(
                  abortReason === "signal"
                    ? "OPERATION_ABORTED"
                    : "OPERATION_TIMEOUT",
                  6,
                  abortReason === "signal"
                    ? "Operation aborted by signal."
                    : `Operation timed out after ${timeout}ms.`,
                ),
              ),
            { once: true },
          ),
        ),
        lease?.lost ?? new Promise<never>(() => {}),
      ]);
      if (controller.signal.aborted)
        fail(
          abortReason === "signal" ? "OPERATION_ABORTED" : "OPERATION_TIMEOUT",
          6,
          "Operation aborted.",
        );
      try {
        data = capability.outputSchema?.parse(data) ?? data;
      } catch (error) {
        if (error instanceof BenchPilotError) throw error;
        fail("INVALID_CAPABILITY_OUTPUT", 5, (error as Error).message);
      }
      logger.event("stage.completed", { stage: capability.id });
    } catch (e: unknown) {
      primaryError =
        e instanceof BenchPilotError
          ? e
          : new BenchPilotError(
              controller.signal.aborted
                ? abortReason === "signal"
                  ? "OPERATION_ABORTED"
                  : "OPERATION_TIMEOUT"
                : "INTERNAL_ERROR",
              controller.signal.aborted ? 6 : 8,
              controller.signal.aborted
                ? abortReason === "signal"
                  ? "Operation aborted."
                  : "Operation timed out."
                : (e as Error).message,
            );
    }
    clearTimeout(timer);
    process.removeListener("SIGINT", onSignal);
    process.removeListener("SIGTERM", onSignal);
    const cleanupWithGrace = async (
      cleanup: () => Promise<void> | void,
      name: string,
    ) => {
      let timer: NodeJS.Timeout | undefined;
      try {
        await Promise.race([
          Promise.resolve(cleanup()),
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () =>
                reject(
                  new BenchPilotError(
                    "CLEANUP_TIMEOUT",
                    5,
                    `Cleanup timed out: ${name}`,
                  ),
                ),
              5_000,
            );
            timer.unref();
          }),
        ]);
      } finally {
        if (timer) clearTimeout(timer);
      }
    };
    for (const cleanup of cleanups.reverse()) {
      try {
        await cleanupWithGrace(cleanup.handler, cleanup.name);
      } catch (error: unknown) {
        cleanupErrors.push({
          name: cleanup.name,
          critical: cleanup.critical,
          message: (error as Error).message,
        });
      }
    }
    if (lease) {
      try {
        await lease.stop();
      } catch (error: unknown) {
        cleanupErrors.push({
          name: "lock-heartbeat",
          critical: true,
          message: (error as Error).message,
        });
      }
    }
    if (claimedApproval) {
      try {
        if (dangerousEffectStarted && (data || primaryError))
          await new ApprovalManager(this.s.paths).consumeClaim(claimedApproval);
        else
          await new ApprovalManager(this.s.paths).releaseClaim(claimedApproval);
      } catch (error: unknown) {
        cleanupErrors.push({
          name: "approval",
          critical: true,
          message: (error as Error).message,
        });
      }
    }
    if (lock) {
      try {
        await new LockManager(this.s.paths).release(lock);
        logger.event("lock.released", { lockId: lock.lockId });
      } catch (error: unknown) {
        cleanupErrors.push({
          name: "lock-release",
          critical: true,
          message: (error as Error).message,
        });
      }
    }
    if (primaryError)
      logger.event(
        "operation.failed",
        {
          kind: primaryError.kind,
          message: primaryError.message,
          cleanupErrors,
        },
        { level: "error" },
      );
    else logger.event("operation.completed", { runId: run?.id, cleanupErrors });
    try {
      await logger.close();
    } catch (error: unknown) {
      cleanupErrors.push({
        name: "logger-close",
        critical: true,
        message: (error as Error).message,
      });
    }
    const criticalCleanupFailed = cleanupErrors.some(
      (error) => error.critical === true,
    );
    if (!artifacts.length && data && object(data) && object(data.artifact))
      artifacts.push(data.artifact);
    if (!primaryError && criticalCleanupFailed)
      primaryError = new BenchPilotError(
        "CLEANUP_FAILED",
        5,
        "Critical operation cleanup failed.",
        false,
        undefined,
        [],
        { cleanupErrors },
      );
    const ok = !primaryError;
    const result: Json = ok
      ? {
          schema: "benchpilot.result",
          version: 1,
          ok: true,
          command,
          runId: run?.id,
          durationMs: Date.now() - started,
          data,
          artifacts,
          cleanupErrors,
        }
      : {
          schema: "benchpilot.result",
          version: 1,
          ok: false,
          command,
          runId: run?.id,
          durationMs: Date.now() - started,
          kind: primaryError!.kind,
          message: primaryError!.message,
          retryable: primaryError!.retryable,
          stage: primaryError!.stage,
          recovery: primaryError!.recovery,
          details: { ...primaryError!.details, cleanupErrors },
        };
    if (run)
      await runManager.finalize(
        run,
        primaryError?.kind === "OPERATION_TIMEOUT" ||
          primaryError?.kind === "OPERATION_ABORTED"
          ? "aborted"
          : ok
            ? "succeeded"
            : "failed",
        result,
      );
    if (primaryError) throw Object.assign(primaryError, { result });
    return result;
  }
}
