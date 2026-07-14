import { createHash, randomBytes } from "node:crypto";
import { promises as fs, constants as fsConstants } from "node:fs";
import os from "node:os";
import path from "node:path";
import TOML from "@iarna/toml";
import RlogModule from "rlog-js";
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

export class BenchPilotError extends Error {
  constructor(
    public kind: string,
    public exitCode: number,
    message: string,
    public retryable = false,
    public stage?: string,
    public recovery: string[] = [],
    public details: Json = {},
  ) {
    super(message);
  }
}
export const fail = (
  kind: string,
  code: number,
  message: string,
  details: Json = {},
): never => {
  throw new BenchPilotError(kind, code, message, false, undefined, [], details);
};
export const sha = (input: unknown) =>
  createHash("sha256")
    .update(typeof input === "string" ? input : stable(input))
    .digest("hex");
export const stable = (input: unknown): string =>
  JSON.stringify(input, (_k, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, v[k]]),
        )
      : v,
  );
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
export async function atomicJson(file: string, data: unknown) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${randomBytes(3).toString("hex")}.tmp`;
  await fs.writeFile(temp, JSON.stringify(data, null, 2));
  await fs.rename(temp, file);
}
export async function readJson<T>(file: string): Promise<T | undefined> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T;
  } catch (e: unknown) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw e;
  }
}

export class PathService {
  constructor(
    readonly env: NodeJS.ProcessEnv = process.env,
    readonly platform = process.platform,
    readonly home = os.homedir(),
    readonly temp = os.tmpdir(),
  ) {}
  get portable() {
    return this.env.BENCHPILOT_HOME;
  }
  globalConfig() {
    if (this.portable) return path.join(this.portable, "config.toml");
    if (this.platform === "win32")
      return path.join(
        this.env.APPDATA || this.home,
        "BenchPilot",
        "config.toml",
      );
    if (this.platform === "darwin")
      return path.join(
        this.home,
        "Library",
        "Application Support",
        "BenchPilot",
        "config.toml",
      );
    return path.join(
      this.env.XDG_CONFIG_HOME || path.join(this.home, ".config"),
      "benchpilot",
      "config.toml",
    );
  }
  stateRoot() {
    if (this.portable) return path.join(this.portable, "state");
    if (this.platform === "win32")
      return path.join(this.env.LOCALAPPDATA || this.temp, "BenchPilot");
    if (this.platform === "darwin")
      return path.join(
        this.home,
        "Library",
        "Application Support",
        "BenchPilot",
      );
    return path.join(
      this.env.XDG_STATE_HOME || path.join(this.home, ".local", "state"),
      "benchpilot",
    );
  }
  runtimeRoot() {
    if (this.portable) return path.join(this.portable, "runtime");
    return path.join(
      this.platform === "win32"
        ? this.env.TEMP || this.temp
        : this.env.XDG_RUNTIME_DIR || this.temp,
      "benchpilot",
      "locks",
    );
  }
  runsRoot(projectKey: string) {
    return this.portable
      ? path.join(this.portable!, "runs")
      : path.join(this.stateRoot(), "projects", projectKey, "runs");
  }
  approvalsRoot() {
    return path.join(this.stateRoot(), "approvals");
  }
  async project(start = process.cwd(), explicit?: string) {
    if (explicit)
      return {
        root: path.dirname(path.resolve(explicit)),
        config: path.resolve(explicit),
      };
    let dir = path.resolve(start);
    while (true) {
      const file = path.join(dir, "benchpilot.toml");
      try {
        await fs.access(file);
        return { root: dir, config: file };
      } catch {}
      const up = path.dirname(dir);
      if (up === dir) return undefined;
      dir = up;
    }
  }
}

const object = (x: unknown): x is Json =>
  !!x && typeof x === "object" && !Array.isArray(x);
export const merge = (low: Json, high: Json): Json => {
  const out: Json = { ...low };
  for (const [k, v] of Object.entries(high))
    out[k] = object(v) && object(out[k]) ? merge(out[k] as Json, v) : v;
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
    return x;
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
  return key
    .split(".")
    .reduce<unknown>((x, p) => (object(x) ? x[p] : undefined), obj);
}
export function setKey(obj: Json, key: string, value: unknown) {
  const parts = key.split(".");
  let cur = obj;
  for (const p of parts.slice(0, -1)) cur = (cur[p] ||= {}) as Json;
  cur[parts.at(-1)!] = value;
}
export function deleteKey(obj: Json, key: string) {
  const ps = key.split(".");
  let cur: Json | undefined = obj;
  for (const p of ps.slice(0, -1)) {
    const next = cur?.[p];
    cur = object(next) ? next : undefined;
  }
  if (cur) delete cur[ps.at(-1)!];
}
export function validateConfig(c: Json) {
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
export interface Capability {
  id: string;
  summary: string;
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
  version: string;
  summary: string;
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
  get(id: string) {
    const a = this.adapters.get(id);
    if (!a) fail("UNKNOWN_ADAPTER", 3, `Unknown adapter: ${id}`);
    return a;
  }
  list() {
    return [...this.adapters.values()];
  }
}

export interface Run {
  id: string;
  dir: string;
  started: number;
  command: string;
}
export class RunManager {
  constructor(
    private paths: PathService,
    private projectId: string,
  ) {}
  async create(command: string, context: Json): Promise<Run> {
    const id = `${new Date()
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(
        /\.\d{3}Z/,
        "Z",
      )}-${command.replace(/\./g, "-")}-${randomBytes(3).toString("hex")}`;
    const dir = path.join(this.paths.runsRoot(this.projectId), id);
    await fs.mkdir(path.join(dir, "captures"), { recursive: true });
    await fs.mkdir(path.join(dir, "artifacts"), { recursive: true });
    const started = Date.now();
    await atomicJson(path.join(dir, "manifest.json"), {
      schema: "benchpilot.run",
      version: 1,
      runId: id,
      status: "running",
      command,
      startedAt: new Date(started).toISOString(),
      pid: process.pid,
      hostname: os.hostname(),
      platform: process.platform,
      ...context,
    });
    return { id, dir, started, command };
  }
  async finish(run: Run, status: string, result: Json) {
    const durationMs = Date.now() - run.started;
    await atomicJson(path.join(run.dir, "result.json"), result);
    const m = (await readJson<Json>(path.join(run.dir, "manifest.json"))) || {};
    await atomicJson(path.join(run.dir, "manifest.json"), {
      ...m,
      status,
      endedAt: new Date().toISOString(),
      durationMs,
    });
  }
  async list() {
    const root = this.paths.runsRoot(this.projectId);
    try {
      return await Promise.all(
        (await fs.readdir(root)).map(async (id) => ({
          id,
          manifest: await readJson<Json>(path.join(root, id, "manifest.json")),
        })),
      );
    } catch (e: unknown) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw e;
    }
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
export class LockManager {
  constructor(private paths: PathService) {}
  file(id: string) {
    return path.join(this.paths.runtimeRoot(), `${id}.json`);
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
  async release(lock: LockRecord) {
    const existing = await readJson<LockRecord>(this.file(lock.lockId));
    if (existing?.ownerToken === lock.ownerToken)
      await fs.unlink(this.file(lock.lockId)).catch(() => {});
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
    const stale = Date.parse(l.expiresAt) < Date.now();
    if (!stale && !dangerous)
      fail(
        "DANGEROUS_CONFIRMATION_REQUIRED",
        7,
        "Active lock requires --dangerously-clear-active-lock.",
      );
    await fs.unlink(this.file(id));
    return l;
  }
}

export class ApprovalManager {
  constructor(private paths: PathService) {}
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
    await atomicJson(
      path.join(this.paths.approvalsRoot(), `${id}.json`),
      record,
    );
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
  async get(id: string) {
    const x = await readJson<Json>(
      path.join(this.paths.approvalsRoot(), `${id}.json`),
    );
    if (!x) fail("APPROVAL_NOT_FOUND", 3, `Approval not found: ${id}`);
    return x;
  }
  async change(id: string, status: "approved" | "rejected") {
    const x = await this.get(id);
    await atomicJson(path.join(this.paths.approvalsRoot(), `${id}.json`), {
      ...x,
      status,
      changedAt: new Date().toISOString(),
    });
  }
  async consume(binding: Json) {
    const digest = sha(binding);
    for (const p of await this.list()) {
      const x = (await p) as Json;
      if (
        x.status === "approved" &&
        x.digest === digest &&
        Date.parse(String(x.expiresAt)) > Date.now()
      ) {
        await atomicJson(
          path.join(this.paths.approvalsRoot(), `${x.id}.json`),
          { ...x, status: "consumed", consumedAt: new Date().toISOString() },
        );
        return true;
      }
    }
    return false;
  }
}

export interface OperationContext {
  signal: AbortSignal;
  logger: InstanceType<typeof Rlog>;
  run?: Run;
  config: Json;
  device: DeviceRuntime;
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
    const command = `device.${capabilityId}`,
      lockId = `${runtime.identity.adapter}-${runtime.identity.physicalId}`;
    const safety = cap.safety;
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
    if (
      safety.mode === "human-approval" &&
      !(await new ApprovalManager(this.s.paths).consume(binding))
    ) {
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
    const timeout = duration(this.s.flags.timeout, cap.defaultTimeoutMs);
    if (this.s.flags["dry-run"])
      return {
        dryRun: true,
        device: runtime.identity,
        capability: cap.id,
        lockId,
        lockMode: cap.lockMode,
        timeoutMs: timeout,
        safety,
      };
    const run = cap.createsRun
      ? await new RunManager(
          this.s.paths,
          String(
            (this.s.config.value.project as Json | undefined)?.id ||
              sha(this.s.project?.root || process.cwd()).slice(0, 12),
          ),
        ).create(command, {
          device: runtime.identity,
          adapter: d.adapter,
          configDigest: sha(this.s.config.value),
        })
      : undefined;
    if (run)
      await atomicJson(
        path.join(run.dir, "resolved-config.json"),
        this.s.config.value,
      );
    const logger = new Rlog({
      logFilePath: run && path.join(run.dir, "benchpilot.log"),
      jsonlFilePath: run && path.join(run.dir, "events.jsonl"),
      jsonlOutput: this.s.flags.jsonl ? process.stdout : "none",
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
    const controller = new AbortController(),
      timer = setTimeout(() => controller.abort(), timeout);
    const onSignal = () => controller.abort();
    process.once("SIGINT", onSignal);
    process.once("SIGTERM", onSignal);
    const started = Date.now();
    try {
      logger.event("operation.started", { command });
      if (cap.lockMode === "exclusive") {
        logger.event("lock.acquiring", { lockId });
        lock = await new LockManager(this.s.paths).acquire(
          lockId,
          command,
          run?.id,
        );
        logger.event("lock.acquired", { lockId });
      }
      logger.event("stage.started", { stage: cap.id });
      const data = await cap.execute(
        {
          signal: controller.signal,
          logger,
          run,
          config: this.s.config.value,
          device: runtime,
        },
        input,
      );
      if (controller.signal.aborted)
        fail("OPERATION_TIMEOUT", 6, `Operation timed out after ${timeout}ms.`);
      const result = {
        schema: "benchpilot.result",
        version: 1,
        ok: true,
        command,
        runId: run?.id,
        durationMs: Date.now() - started,
        data,
        artifacts: [],
      };
      logger.event("stage.completed", { stage: cap.id });
      logger.event("operation.completed", { runId: run?.id });
      if (run)
        await new RunManager(this.s.paths, "").finish(run, "succeeded", result);
      return result;
    } catch (e: unknown) {
      const err =
        e instanceof BenchPilotError
          ? e
          : new BenchPilotError(
              controller.signal.aborted
                ? "OPERATION_TIMEOUT"
                : "INTERNAL_ERROR",
              controller.signal.aborted ? 6 : 8,
              controller.signal.aborted
                ? "Operation timed out."
                : (e as Error).message,
            );
      logger.event(
        "operation.failed",
        { kind: err.kind, message: err.message },
        { level: "error" },
      );
      const result = {
        schema: "benchpilot.result",
        version: 1,
        ok: false,
        command,
        runId: run?.id,
        durationMs: Date.now() - started,
        kind: err.kind,
        message: err.message,
        retryable: err.retryable,
        stage: err.stage,
        recovery: err.recovery,
        details: err.details,
      };
      if (run)
        await new RunManager(this.s.paths, "").finish(
          run,
          controller.signal.aborted ? "aborted" : "failed",
          result,
        );
      throw Object.assign(err, { result });
    } finally {
      clearTimeout(timer);
      process.removeListener("SIGINT", onSignal);
      process.removeListener("SIGTERM", onSignal);
      if (lock) {
        await new LockManager(this.s.paths).release(lock);
        logger.event("lock.released", { lockId: lock.lockId });
      }
      await logger.close();
    }
  }
}
