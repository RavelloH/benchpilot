import { promises as fs } from "node:fs";
import path from "node:path";
import TOML from "@iarna/toml";
import RlogModule from "rlog-js";
import { BenchPilotError, fail } from "./core/errors/benchpilot-error.js";
import {
  SchemaValidationError,
  type RuntimeSchema,
} from "./core/adapters/schemas.js";
import { AdapterRegistry } from "./core/adapters/registry.js";
import type { Adapter } from "./core/adapters/types.js";
import { lockIdentity } from "./core/locks/lock-identity.js";
import { LockManager } from "./core/locks/lock-manager.js";
import type { LockLease, LockRecord } from "./core/locks/types.js";
import { ApprovalManager } from "./core/approvals/approval-manager.js";
import type { ApprovalLease, ApprovalRecord } from "./core/approvals/types.js";
import type { BenchPilotEventWriter } from "./core/events/types.js";
import {
  abortPromise,
  abortReasonToError,
  type OperationAbortReason,
} from "./core/operations/abort.js";
import type {
  CleanupError,
  OperationOutcome,
} from "./core/operations/operation-outcome.js";
import type {
  OperationContext,
  OperationServices,
} from "./core/operations/types.js";
import { runCleanupWithGrace } from "./core/operations/cleanup.js";
import { PathService } from "./core/paths/path-service.js";
import { atomicJson } from "./core/utilities/atomic-json.js";
import { sha, stable } from "./core/utilities/stable-json.js";
import { RunManager } from "./core/runs/run-manager.js";
import type { ArtifactRecord, Run } from "./core/runs/run-manager.js";
import { ArtifactRegistry } from "./core/artifacts/artifact-registry.js";
import type {
  ArtifactRegistration,
  ArtifactRecord as RegisteredArtifactRecord,
} from "./core/artifacts/types.js";
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
  SchemaValidationError,
  stringSchema,
} from "./core/adapters/schemas.js";
export type { RuntimeSchema } from "./core/adapters/schemas.js";
export { AdapterRegistry } from "./core/adapters/registry.js";
export type { Adapter } from "./core/adapters/types.js";
export {
  lockIdentity,
  type PhysicalResourceIdentity,
} from "./core/locks/lock-identity.js";
export { LockManager } from "./core/locks/lock-manager.js";
export type {
  LockLease,
  LockLiveness,
  LockManagerHooks,
  LockRecord,
} from "./core/locks/types.js";
export { ApprovalManager } from "./core/approvals/approval-manager.js";
export type {
  ApprovalLease,
  ApprovalLiveness,
  ApprovalRecord,
} from "./core/approvals/types.js";
export { EventWriter } from "./core/events/event-writer.js";
export type {
  BenchPilotEvent,
  BenchPilotEventWriter,
} from "./core/events/types.js";
export type {
  CleanupError,
  OperationOutcome,
} from "./core/operations/operation-outcome.js";
export type {
  OperationContext,
  OperationServices,
} from "./core/operations/types.js";
export { runCleanupWithGrace } from "./core/operations/cleanup.js";
export {
  abortPromise,
  abortReasonToError,
  type OperationAbortReason,
} from "./core/operations/abort.js";
export { PathService } from "./core/paths/path-service.js";
export { atomicJson, readJson } from "./core/utilities/atomic-json.js";
export { sha, stable } from "./core/utilities/stable-json.js";
export {
  isSupportedNodeVersion,
  parseNodeVersion,
  type NodeVersion,
} from "./core/utilities/node-version.js";
export { resolveInside } from "./core/utilities/resolve-inside.js";
export {
  RunManager,
  RUN_ID_PATTERN,
  type ArtifactRecord,
  type Run,
} from "./core/runs/run-manager.js";
export { ArtifactRegistry } from "./core/artifacts/artifact-registry.js";
export type {
  ArtifactRegistration,
  ArtifactRecord as RegisteredArtifactRecord,
} from "./core/artifacts/types.js";
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
    const adapter = this.s.registry.get(String(d.adapter));
    const runtime = await this.s.registry.createDevice(
      adapter,
      instance,
      d,
      this.s.config.value,
    );
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
        try {
          input[option.name] = option.schema.parse(input[option.name]);
        } catch (error) {
          throw new BenchPilotError(
            "INVALID_CAPABILITY_INPUT",
            2,
            (error as Error).message,
          );
        }
    }
    try {
      input = capability.inputSchema?.parse(input) ?? input;
    } catch (error) {
      if (error instanceof BenchPilotError) throw error;
      throw new BenchPilotError(
        "INVALID_CAPABILITY_INPUT",
        2,
        (error as Error).message,
      );
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
      const approvals = new ApprovalManager(this.s.paths);
      const existing =
        (await approvals.findMatchingApproval(binding)) ||
        (await approvals.recoverMatchingStaleClaim(binding));
      if (!existing) {
        const req = await approvals.request(binding, safety.approvalTtlMs);
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
    const emit = (
      type: string,
      data: Json = {},
      options?: { level?: "error" | "warn" | "info" | "debug" },
    ) => {
      logger.event(type, data, options);
      this.s.eventWriter?.emit(type, data);
    };
    let lock: LockRecord | undefined;
    let lease: LockLease | undefined;
    let claimedApproval: ApprovalRecord | undefined;
    let approvalLease: ApprovalLease | undefined;
    const cleanups: Array<{
      name: string;
      critical: boolean;
      handler: () => Promise<void> | void;
    }> = [];
    const cleanupErrors: CleanupError[] = [];
    const artifacts: RegisteredArtifactRecord[] = [];
    const artifactRegistry = run ? new ArtifactRegistry(run) : undefined;
    let dangerousEffectStarted = false;
    let dangerousEffectStartedAt: string | undefined;
    let dangerousEffectDetails: Json | undefined;
    let approvalFinalStatus: "released" | "consumed" | undefined;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort({
        kind: "timeout",
        timeoutMs: timeout,
      } satisfies OperationAbortReason);
    }, timeout);
    const abortForSignal = (signal: "SIGINT" | "SIGTERM") => {
      if (!controller.signal.aborted)
        controller.abort({
          kind: "signal",
          signal,
        } satisfies OperationAbortReason);
    };
    const onSigint = () => abortForSignal("SIGINT");
    const onSigterm = () => abortForSignal("SIGTERM");
    process.once("SIGINT", onSigint);
    process.once("SIGTERM", onSigterm);
    const started = Date.now();
    let data: Json | undefined;
    let primaryError: BenchPilotError | undefined;
    let approvalLoss = new Promise<never>(() => {});
    try {
      emit("operation.started", { command, runId: run?.id });
      if (capability.lockMode === "exclusive") {
        emit("lock.acquiring", { lockId });
        lock = await new LockManager(this.s.paths).acquire(
          lockId,
          command,
          run?.id,
          {
            adapter: runtime.identity.adapter,
            kind: "device",
            physicalId: runtime.identity.physicalId,
          },
          this.s.flags.session ? String(this.s.flags.session) : undefined,
        );
        lease = new LockManager(this.s.paths).startHeartbeat(
          lock,
          this.s.lockHeartbeatIntervalMs,
          this.s.lockLeaseMs,
        );
        emit("lock.acquired", { lockId });
      }
      if (safety.mode === "human-approval") {
        claimedApproval = await new ApprovalManager(this.s.paths).claim(
          binding,
        );
        if (!claimedApproval)
          throw new BenchPilotError(
            "APPROVAL_ALREADY_CLAIMED",
            7,
            "Matching approval is no longer available.",
          );
        approvalLease = new ApprovalManager(this.s.paths).startClaimLease(
          claimedApproval,
        );
        approvalLoss = approvalLease.lost.then((error) => {
          if (!controller.signal.aborted)
            controller.abort({
              kind: "manual",
              message: `Approval ownership lost: ${error.message}`,
            } satisfies OperationAbortReason);
          throw error;
        });
      }
      emit("stage.started", { stage: capability.id });
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
          get dangerousEffect() {
            return {
              started: dangerousEffectStarted,
              startedAt: dangerousEffectStartedAt,
              details: dangerousEffectDetails,
            };
          },
          markDangerousEffectStarted(details) {
            dangerousEffectStarted = true;
            dangerousEffectStartedAt ||= new Date().toISOString();
            dangerousEffectDetails ||= details;
          },
          emitEvent(type, eventData = {}) {
            emit(type, eventData);
          },
          async registerArtifact(record) {
            if (!artifactRegistry)
              throw new BenchPilotError(
                "INVALID_ARTIFACT",
                5,
                "Artifacts require a Run.",
              );
            const artifact = await artifactRegistry.register(record);
            artifacts.push(artifact);
            return artifact;
          },
        },
        input,
      );
      const lockLoss = lease
        ? lease.lost.catch((error: BenchPilotError) => {
            if (!controller.signal.aborted)
              controller.abort({
                kind: "lock-ownership-lost",
                lockId,
                error,
              } satisfies OperationAbortReason);
            throw error;
          })
        : new Promise<never>(() => {});
      data = await Promise.race([
        execution,
        abortPromise(controller.signal),
        lockLoss,
        approvalLoss,
      ]);
      if (controller.signal.aborted)
        throw abortReasonToError(controller.signal.reason);
      try {
        data = capability.outputSchema?.parse(data) ?? data;
      } catch (error) {
        if (error instanceof SchemaValidationError)
          throw new BenchPilotError(
            "INVALID_CAPABILITY_OUTPUT",
            5,
            error.message,
            false,
            undefined,
            [],
            {
              path: error.path,
              expected: error.expected,
              actual: error.actual,
            },
          );
        throw error;
      }
      emit("stage.completed", { stage: capability.id });
    } catch (e: unknown) {
      primaryError =
        e instanceof BenchPilotError
          ? e
          : new BenchPilotError(
              controller.signal.aborted
                ? abortReasonToError(controller.signal.reason).kind
                : "INTERNAL_ERROR",
              controller.signal.aborted ? 6 : 8,
              controller.signal.aborted
                ? abortReasonToError(controller.signal.reason).message
                : (e as Error).message,
            );
    }
    clearTimeout(timer);
    process.removeListener("SIGINT", onSigint);
    process.removeListener("SIGTERM", onSigterm);
    for (const cleanup of cleanups.reverse()) {
      try {
        await runCleanupWithGrace(cleanup.handler, cleanup.name);
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
    if (approvalLease) {
      try {
        await approvalLease.stop();
      } catch (error: unknown) {
        cleanupErrors.push({
          name: "approval-heartbeat",
          critical: true,
          message: (error as Error).message,
        });
      }
    }
    if (claimedApproval) {
      try {
        if (dangerousEffectStarted && (data || primaryError)) {
          await new ApprovalManager(this.s.paths).consumeClaim(claimedApproval);
          approvalFinalStatus = "consumed";
        } else {
          await new ApprovalManager(this.s.paths).releaseClaim(claimedApproval);
          approvalFinalStatus = "released";
        }
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
        emit("lock.released", { lockId: lock.lockId });
      } catch (error: unknown) {
        cleanupErrors.push({
          name: "lock-release",
          critical: true,
          message: (error as Error).message,
        });
      }
    }
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
    const abortReason = controller.signal.aborted
      ? (controller.signal.reason as Json)
      : undefined;
    const signal =
      abortReason?.kind === "signal" ? String(abortReason.signal) : undefined;
    const lockLoss =
      abortReason?.kind === "lock-ownership-lost"
        ? { lockId: abortReason.lockId }
        : undefined;
    const outcomeFields = {
      cleanupErrors,
      abortReason,
      signal,
      timeoutMs: timeout,
      lockLoss,
      approvalFinalStatus,
      dangerousEffectStarted,
      dangerousEffectStartedAt,
      dangerousEffectDetails,
    };
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
          ...outcomeFields,
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
          ...outcomeFields,
          details: { ...primaryError!.details, cleanupErrors },
        };
    const status: OperationOutcome["status"] =
      primaryError?.kind === "OPERATION_TIMEOUT" ||
      primaryError?.kind === "OPERATION_ABORTED"
        ? "aborted"
        : ok
          ? "succeeded"
          : "failed";
    const outcome: OperationOutcome = {
      status,
      result,
      primaryError,
      cleanupErrors,
    };
    if (run) await runManager.finalize(run, outcome.status, outcome.result);
    if (outcome.primaryError) {
      this.s.eventWriter?.failed(outcome.result);
      throw Object.assign(outcome.primaryError, {
        result: outcome.result,
        jsonlTerminalEmitted: Boolean(this.s.eventWriter),
      });
    }
    this.s.eventWriter?.completed(outcome.result);
    return outcome.result;
  }
}
