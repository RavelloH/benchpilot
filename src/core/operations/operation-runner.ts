import path from "node:path";
import RlogModule from "rlog-js";
import { SchemaValidationError } from "../adapters/schemas.js";
import { BenchPilotError, fail } from "../errors/benchpilot-error.js";
import { lockIdentity } from "../locks/lock-identity.js";
import { LockManager } from "../locks/lock-manager.js";
import type { LockLease, LockRecord } from "../locks/types.js";
import { ApprovalManager } from "../approvals/approval-manager.js";
import type { ApprovalLease, ApprovalRecord } from "../approvals/types.js";
import type { BenchPilotEventWriter } from "../events/types.js";
import {
  abortPromise,
  abortReasonToError,
  type OperationAbortReason,
} from "./abort.js";
import type { CleanupError, OperationOutcome } from "./operation-outcome.js";
import type {
  OperationContext,
  OperationExecutionOptions,
  OperationServices,
} from "./types.js";
import { runCleanupWithGrace } from "./cleanup.js";
import { atomicJson } from "../utilities/atomic-json.js";
import { sha } from "../utilities/stable-json.js";
import { RunManager } from "../runs/run-manager.js";
import { ArtifactRegistry } from "../artifacts/artifact-registry.js";
import type { ArtifactRecord as RegisteredArtifactRecord } from "../artifacts/types.js";
import {
  duration,
  projectStorageKey,
  redactResolvedConfig,
  type Json,
} from "../config/config.js";
const Rlog = RlogModule.default;

const object = (value: unknown): value is Json =>
  !!value && typeof value === "object" && !Array.isArray(value);

export class OperationRunner {
  constructor(private s: OperationServices) {}
  async execute(
    instance: string,
    capabilityId: string,
    input: Json,
    options: OperationExecutionOptions = {},
  ): Promise<Json> {
    const eventWriter =
      options.eventContext && this.s.eventWriter?.child
        ? this.s.eventWriter.child(options.eventContext)
        : this.s.eventWriter;
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
      this.s.paths,
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
      enableColorfulOutput: this.s.flags.color !== false,
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
      eventWriter?.emit(type, data);
    };
    let lock: LockRecord | undefined;
    let lease: LockLease | undefined;
    let claimedApproval: ApprovalRecord | undefined;
    let approvalLease: ApprovalLease | undefined;
    const cleanups: Array<{
      name: string;
      critical: boolean;
      holdsPhysicalResource: boolean;
      timeoutMs?: number;
      handler: () => Promise<void> | void;
    }> = [];
    const cleanupErrors: CleanupError[] = [];
    const artifacts: RegisteredArtifactRecord[] = [];
    const artifactRegistry = run ? new ArtifactRegistry(run) : undefined;
    let dangerousEffectStarted = false;
    let dangerousEffectStartedAt: string | undefined;
    let dangerousEffectDetails: Json | undefined;
    let approvalFinalStatus: "released" | "consumed" | undefined;
    let lockFinalStatus:
      "not-required" | "released" | "quarantined" | "ownership-lost" =
      "not-required";
    let quarantinedLock: { lockId: string; reason: Json } | undefined;
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
    let capabilityStageStarted = false;
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
        emit("approval.claimed", { approvalId: claimedApproval.id });
        approvalLoss = approvalLease.lost.then((error) => {
          if (!controller.signal.aborted)
            controller.abort({
              kind: "manual",
              message: `Approval ownership lost: ${error.message}`,
            } satisfies OperationAbortReason);
          throw error;
        });
      }
      capabilityStageStarted = true;
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
              holdsPhysicalResource: options?.holdsPhysicalResource ?? true,
              timeoutMs: options?.timeoutMs,
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
      if (capabilityStageStarted)
        emit("stage.failed", {
          stage: capability.id,
          kind: primaryError.kind,
          message: primaryError.message,
        });
    }
    const operationSucceeded = !primaryError;
    if (
      operationSucceeded &&
      safety.mode === "human-approval" &&
      !dangerousEffectStarted
    )
      emit(
        "safety.marker-missing",
        {
          approvalId: claimedApproval?.id,
          capability: capability.id,
          code: "DANGEROUS_EFFECT_MARKER_MISSING",
        },
        { level: "warn" },
      );
    clearTimeout(timer);
    process.removeListener("SIGINT", onSigint);
    process.removeListener("SIGTERM", onSigterm);
    emit("cleanup.started");
    for (const cleanup of cleanups.reverse()) {
      try {
        await runCleanupWithGrace(
          cleanup.handler,
          cleanup.name,
          cleanup.timeoutMs,
        );
        emit("cleanup.completed", { name: cleanup.name });
      } catch (error: unknown) {
        cleanupErrors.push({
          name: cleanup.name,
          critical: cleanup.critical,
          holdsPhysicalResource: cleanup.holdsPhysicalResource,
          timedOut: (error as BenchPilotError).kind === "CLEANUP_TIMEOUT",
          message: (error as Error).message,
        });
        emit("cleanup.failed", {
          name: cleanup.name,
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
          holdsPhysicalResource: true,
          timedOut: false,
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
          holdsPhysicalResource: false,
          timedOut: false,
          message: (error as Error).message,
        });
      }
    }
    if (claimedApproval) {
      try {
        if (operationSucceeded || dangerousEffectStarted) {
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
          holdsPhysicalResource: false,
          timedOut: false,
          message: (error as Error).message,
        });
      }
    }
    emit("cleanup.completed", { errors: cleanupErrors.length });
    const physicalCleanupUnsafe = cleanupErrors.some(
      (error) => error.holdsPhysicalResource,
    );
    if (lock) {
      try {
        const locks = new LockManager(this.s.paths);
        if (physicalCleanupUnsafe) {
          const reason = {
            kind: "CLEANUP_FAILED",
            message: "Critical operation cleanup failed or timed out.",
            cleanupErrors,
            runId: run?.id,
          };
          await locks.quarantine(lock, reason);
          lockFinalStatus = "quarantined";
          quarantinedLock = { lockId: lock.lockId, reason };
          emit("lock.quarantined", { lockId: lock.lockId, reason });
        } else {
          await locks.release(lock);
          lockFinalStatus = "released";
          emit("lock.released", { lockId: lock.lockId });
        }
      } catch (error: unknown) {
        if ((error as BenchPilotError).kind === "LOCK_OWNERSHIP_LOST")
          lockFinalStatus = "ownership-lost";
        cleanupErrors.push({
          name: "lock-release",
          critical: true,
          holdsPhysicalResource: true,
          timedOut: false,
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
        holdsPhysicalResource: false,
        timedOut: false,
        message: (error as Error).message,
      });
    }
    const operationCleanupFailed = cleanupErrors.some(
      (error) => error.critical || error.holdsPhysicalResource,
    );
    if (!primaryError && operationCleanupFailed)
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
      lockFinalStatus,
      quarantinedLock,
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
      lockFinalStatus,
      quarantinedLock,
    };
    if (run) await runManager.finalize(run, outcome.status, outcome.result);
    if (outcome.primaryError) {
      if (options.eventScope === "child")
        eventWriter?.emit("device.operation.failed", { error: outcome.result });
      else eventWriter?.failed(outcome.result);
      throw Object.assign(outcome.primaryError, {
        result: outcome.result,
        jsonlTerminalEmitted: Boolean(eventWriter),
      });
    }
    if (options.eventScope === "child")
      eventWriter?.emit("device.operation.completed", {
        result: outcome.result,
      });
    else eventWriter?.completed(outcome.result);
    return outcome.result;
  }

  emitSystemEvent(type: string, data: Json = {}) {
    this.s.eventWriter?.emit(type, data);
  }
}
