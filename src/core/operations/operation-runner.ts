import path from "node:path";
import { SchemaValidationError } from "../adapters/schemas.js";
import { BenchPilotError, fail } from "../errors/benchpilot-error.js";
import { lockIdentity } from "../locks/lock-identity.js";
import { LockManager } from "../locks/lock-manager.js";
import type { LockLease, LockRecord } from "../locks/types.js";
import { ApprovalManager } from "../approvals/approval-manager.js";
import type { ApprovalLease, ApprovalRecord } from "../approvals/types.js";
import {
  abortPromise,
  abortReasonToError,
  type OperationAbortReason,
} from "./abort.js";
import type { CleanupError, OperationOutcome } from "./operation-outcome.js";
import type {
  OperationContext,
  OperationExecutionOptions,
  OperationLifecycleFactories,
  OperationServices,
} from "./types.js";
import { runCleanupWithGrace } from "./cleanup.js";
import { OperationSession } from "./operation-session.js";
import { atomicJson } from "../utilities/atomic-json.js";
import { sha } from "../utilities/stable-json.js";
import { RunManager } from "../runs/run-manager.js";
import { ArtifactRegistry } from "../artifacts/artifact-registry.js";
import type { ArtifactRecord as RegisteredArtifactRecord } from "../artifacts/types.js";
import { describeCapability } from "../capabilities/descriptor.js";
import type {
  Capability,
  DeviceRuntime,
  ManagedSessionPlan,
} from "../capabilities/types.js";
import {
  approvalLevel,
  duration,
  redactResolvedConfig,
  requiresApproval,
  type Json,
} from "../config/config.js";

const object = (value: unknown): value is Json =>
  !!value && typeof value === "object" && !Array.isArray(value);

export class OperationRunner {
  private readonly lifecycle: OperationLifecycleFactories;

  constructor(private s: OperationServices) {
    this.lifecycle = s.lifecycle ?? {
      locks: new LockManager(s.paths),
      approvals: (projectRoot) => new ApprovalManager(s.paths, projectRoot),
      runs: (projectRoot) => new RunManager(s.paths, projectRoot),
    };
  }

  /**
   * Read-only capability catalog for application planning.  It creates the
   * adapter runtime but never creates a Run, lock, approval, or device action.
   */
  async listCapabilities(instance: string) {
    const raw = (this.s.config.value.devices as Json | undefined)?.[instance];
    if (!object(raw))
      fail("DEVICE_NOT_FOUND", 3, `Device not found: ${instance}`);
    const device = raw as Json;
    const adapter = this.s.registry.get(String(device.adapter));
    const runtime = await this.s.registry.createDevice(
      adapter,
      instance,
      device,
      this.s.config.value,
      this.s.paths,
    );
    return runtime.capabilities().map(describeCapability);
  }

  /**
   * Creates or finds a required approval without creating a Run, Lock, or
   * executing a capability.  Application uses this for all-member system
   * preflight so a system never partially executes while approvals are being
   * requested.
   */
  async preflightApproval(
    instance: string,
    capabilityId: string,
    input: Json,
    approvalOptions: Pick<OperationExecutionOptions, "approvalMode"> = {},
  ) {
    const project = this.requireProject();
    const raw = (this.s.config.value.devices as Json | undefined)?.[instance];
    if (!object(raw))
      fail("DEVICE_NOT_FOUND", 3, `Device not found: ${instance}`);
    const deviceConfig = raw as Json;
    const adapter = this.s.registry.get(String(deviceConfig.adapter));
    const runtime = await this.s.registry.createDevice(
      adapter,
      instance,
      deviceConfig,
      this.s.config.value,
      this.s.paths,
    );
    const capability = runtime
      .capabilities()
      .find((candidate) => candidate.id === capabilityId);
    if (!capability)
      fail(
        "UNSUPPORTED_CAPABILITY",
        3,
        `Device ${instance} does not support ${capabilityId}.`,
      );
    const definition = capability!;
    const safety = definition.safety;
    const approvalRequired =
      approvalOptions.approvalMode === "agent" &&
      requiresApproval(approvalLevel(this.s.config.value), safety.mode);
    if (!approvalRequired) return { required: false };
    let validated = structuredClone(input);
    const options = definition.options || [];
    const allowed = new Set(options.map((option) => option.name));
    for (const name of Object.keys(validated))
      if (!allowed.has(name))
        fail(
          "INVALID_CAPABILITY_INPUT",
          2,
          `Unknown option for ${definition.id}: ${name}`,
        );
    for (const option of options) {
      if (option.required && validated[option.name] === undefined)
        fail(
          "INVALID_CAPABILITY_INPUT",
          2,
          `Missing required option: ${option.name}.`,
        );
      if (validated[option.name] !== undefined && option.schema)
        validated[option.name] = option.schema.parse(validated[option.name]);
    }
    validated = definition.inputSchema?.parse(validated) ?? validated;
    const binding = {
      command: `device.${capabilityId}`,
      device: runtime.identity,
      input: validated,
      project:
        (this.s.config.value.project as Json | undefined)?.id ||
        "outside-project",
      configDigest: sha(this.s.config.value),
    };
    const storedBinding: Json = {
      ...binding,
      input: definition.redactInput
        ? definition.redactInput(validated)
        : validated,
      presentation: {
        command: {
          capability: definition.id,
          summary: definition.summary,
        },
        ...(typeof (this.s.config.value.project as Json | undefined)?.name ===
        "string"
          ? {
              project: {
                name: (this.s.config.value.project as Json).name,
              },
            }
          : {}),
      },
    };
    const approvals = this.lifecycle.approvals(project.root);
    const approved =
      (await approvals.findMatchingApproval(binding)) ||
      (await approvals.recoverMatchingStaleClaim(binding));
    if (approved)
      return { required: true, ready: true, approvalId: approved.id };
    const pending = await approvals.findPendingApproval(binding);
    if (pending)
      return { required: true, ready: false, approvalId: pending.id };
    const request = await approvals.request(
      binding,
      safety.approvalTtlMs,
      storedBinding,
    );
    return { required: true, ready: false, approvalId: request.id };
  }

  async execute(
    instance: string,
    capabilityId: string,
    input: Json,
    options: OperationExecutionOptions = {},
  ): Promise<Json> {
    const project = this.requireProject();
    const raw = (this.s.config.value.devices as Json | undefined)?.[instance];
    if (!object(raw))
      fail("DEVICE_NOT_FOUND", 3, `Device not found: ${instance}`);
    const d = raw as Json;
    const reporterContext = {
      adapter: String((d as Record<string, Json>).adapter),
      ...(options.eventContext &&
      typeof options.eventContext === "object" &&
      !Array.isArray(options.eventContext)
        ? (options.eventContext as Record<string, Json>)
        : {}),
    };
    const reporter = this.s.reporter?.child
      ? this.s.reporter.child(reporterContext)
      : this.s.reporter;
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
    const definedOptions = capability.options;
    const allowedOptions = new Set(
      (definedOptions ?? []).map((option) => option.name),
    );
    if (definedOptions)
      for (const name of Object.keys(input))
        if (!allowedOptions.has(name))
          fail(
            "INVALID_CAPABILITY_INPUT",
            2,
            `Unknown option for ${capability.id}: ${name}.`,
          );
    for (const option of definedOptions ?? []) {
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
    const managedPlan = runtime.resolveManagedSession?.(capabilityId, {
      projectRoot: project.root,
    });
    if (managedPlan && runtime.identity.stable === false)
      fail(
        "DEVICE_IDENTITY_UNAVAILABLE",
        3,
        "A managed session requires a stable physical device identity.",
      );
    if (
      capability.lockMode === "exclusive" &&
      runtime.identity.stable === false
    )
      fail(
        "DEVICE_IDENTITY_UNAVAILABLE",
        3,
        "A device lock requires a stable physical identity.",
      );
    const command = `device.${capabilityId}`,
      lockId = lockIdentity({
        adapter: runtime.identity.adapter,
        kind: "device",
        physicalId: runtime.identity.physicalId,
      });
    const safety = capability.safety;
    const approvalRequired =
      options.approvalMode === "agent" &&
      requiresApproval(approvalLevel(this.s.config.value), safety.mode);
    const approvals = this.lifecycle.approvals(project.root);
    const binding = {
      command,
      device: runtime.identity,
      input,
      project:
        (this.s.config.value.project as Json | undefined)?.id ||
        "outside-project",
      configDigest: sha(this.s.config.value),
    };
    const storedBinding: Json = {
      ...binding,
      input: capability.redactInput ? capability.redactInput(input) : input,
      presentation: {
        command: {
          capability: capability.id,
          summary: capability.summary,
        },
        ...(typeof (this.s.config.value.project as Json | undefined)?.name ===
        "string"
          ? {
              project: {
                name: (this.s.config.value.project as Json).name,
              },
            }
          : {}),
      },
    };
    const timeout = duration(
      this.s.defaults?.timeout,
      capability.defaultTimeoutMs,
    );
    if (this.s.defaults?.dryRun) {
      const now = new Date();
      const result = {
        schema: "benchpilot.operation-outcome" as const,
        version: 1 as const,
        status: "succeeded" as const,
        command,
        subject: {
          adapter: String(d.adapter),
          capability: capability.id,
          device: runtime.identity,
        },
        execution: {
          startedAt: now.toISOString(),
          endedAt: now.toISOString(),
          durationMs: 0,
          dryRun: true,
        },
        plan: {
          lockId,
          lockMode: capability.lockMode,
          timeoutMs: timeout,
          safety,
          approvalRequired,
        },
      };
      options.onOutcome?.({
        status: "succeeded",
        command,
        subject: {
          adapter: String(d.adapter),
          capability: capability.id,
          device: { instance, physicalId: runtime.identity.physicalId },
        },
        execution: {
          status: "succeeded",
          startedAt: now.toISOString(),
          endedAt: now.toISOString(),
          durationMs: 0,
          dryRun: true,
        },
        artifacts: [],
        result,
        cleanupErrors: [],
        lockFinalStatus: "not-required",
      });
      return result;
    }
    if (managedPlan)
      return this.executeManagedSession({
        instance,
        adapterId: String(d.adapter),
        runtime,
        capability,
        plan: managedPlan,
        input,
        command,
        lockId,
        project,
        approvalRequired,
        binding,
        storedBinding,
        options,
      });
    if (approvalRequired) {
      const existing =
        (await approvals.findMatchingApproval(binding)) ||
        (await approvals.recoverMatchingStaleClaim(binding));
      if (!existing) {
        const req = await approvals.request(
          binding,
          safety.approvalTtlMs,
          storedBinding,
        );
        fail(
          "HUMAN_APPROVAL_REQUIRED",
          7,
          "Human approval is required before this operation can run.",
          { approvalId: req.id },
        );
      }
    }
    const session = new OperationSession(command);
    session.transition("prepared");
    const runManager = this.lifecycle.runs(project.root);
    const run = capability.createsRun
      ? await runManager.create(command, {
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
          benchpilotVersion: this.s.defaults?.benchpilotVersion ?? "unknown",
          nodeVersion: process.version,
        })
      : undefined;
    if (run) {
      const snapshot = redactResolvedConfig(this.s.config.value);
      const adapterConfig = this.s.registry.configFor(
        adapter,
        this.s.config.value,
      );
      if (adapter.redactConfig && object(snapshot.adapters))
        (snapshot.adapters as Json)[adapter.id] =
          adapter.redactConfig(adapterConfig);
      if (adapter.redactDeviceConfig && object(snapshot.devices)) {
        const device = { ...d };
        delete device.adapter;
        (snapshot.devices as Json)[instance] = {
          adapter: d.adapter,
          ...adapter.redactDeviceConfig(device),
        };
      }
      await atomicJson(path.join(run.dir, "resolved-config.json"), snapshot);
    }
    const logger = this.s.businessLogs.open({
      logFilePath: run && path.join(run.dir, "benchpilot.log"),
      jsonlFilePath: run && path.join(run.dir, "events.jsonl"),
      context: {
        runId: run?.id,
        command,
        device: instance,
        adapter: d.adapter,
      },
    });
    const emit = (
      type: string,
      data: Json = {},
      options?: { level?: "error" | "warn" | "info" | "debug" },
    ) => {
      logger.event(type, data, options);
      reporter?.emit(type, data, options);
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
      | "not-required"
      | "released"
      | "quarantined"
      | "ownership-lost"
      | "quarantine-failed" = "not-required";
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
      session.transition("running");
      emit("operation.started", { command, runId: run?.id });
      if (capability.lockMode === "exclusive") {
        emit("lock.acquiring", { lockId });
        lock = await this.lifecycle.locks.acquire(
          lockId,
          command,
          run?.id,
          {
            adapter: runtime.identity.adapter,
            kind: "device",
            physicalId: runtime.identity.physicalId,
          },
          this.s.defaults?.session,
        );
        lease = this.lifecycle.locks.startHeartbeat(
          lock,
          this.s.lockHeartbeatIntervalMs,
          this.s.lockLeaseMs,
        );
        emit("lock.acquired", { lockId });
      }
      if (approvalRequired) {
        claimedApproval = await approvals.claim(binding);
        if (!claimedApproval)
          throw new BenchPilotError(
            "APPROVAL_ALREADY_CLAIMED",
            7,
            "Matching approval is no longer available.",
          );
        approvalLease = approvals.startClaimLease(claimedApproval);
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
          stateRoot: this.s.paths.projectStateRoot(project.root),
          project,
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
    if (operationSucceeded && approvalRequired && !dangerousEffectStarted)
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
    session.transition("cleaning");
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
          await approvals.consumeClaim(claimedApproval);
          approvalFinalStatus = "consumed";
        } else {
          await approvals.releaseClaim(claimedApproval);
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
        const locks = this.lifecycle.locks;
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
        else if (physicalCleanupUnsafe) {
          const reason = {
            kind: "QUARANTINE_FAILED",
            message: "Lock quarantine failed; manual recovery is required.",
            cleanupErrors,
            runId: run?.id,
          };
          try {
            const locks = this.lifecycle.locks;
            await locks.recordQuarantineFailure(lock, reason);
            await locks.markQuarantineFailed(lock, reason);
            lockFinalStatus = "quarantine-failed";
            quarantinedLock = { lockId: lock.lockId, reason };
            emit("lock.quarantine-failed", { lockId: lock.lockId, reason });
          } catch {
            lockFinalStatus = "quarantine-failed";
          }
        }
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
    const endedAt = new Date();
    const durationMs = Math.max(0, endedAt.getTime() - started);
    const status: OperationOutcome["status"] =
      primaryError?.kind === "OPERATION_TIMEOUT" ||
      primaryError?.kind === "OPERATION_ABORTED"
        ? "aborted"
        : ok
          ? "succeeded"
          : "failed";
    const output =
      ok && data ? (capability.redactOutput?.(data) ?? data) : undefined;
    const result: Json = ok
      ? {
          schema: "benchpilot.operation-outcome",
          version: 1,
          status,
          command,
          subject: {
            adapter: String(d.adapter),
            capability: capability.id,
            device: runtime.identity,
          },
          execution: {
            startedAt: new Date(started).toISOString(),
            endedAt: endedAt.toISOString(),
            durationMs,
            runId: run?.id,
            dryRun: false,
          },
          ...(output !== undefined ? { output } : {}),
          artifacts,
          lifecycle: outcomeFields,
        }
      : {
          schema: "benchpilot.operation-outcome",
          version: 1,
          status,
          command,
          subject: {
            adapter: String(d.adapter),
            capability: capability.id,
            device: runtime.identity,
          },
          execution: {
            startedAt: new Date(started).toISOString(),
            endedAt: endedAt.toISOString(),
            durationMs,
            runId: run?.id,
            dryRun: false,
          },
          error: {
            kind: primaryError!.kind,
            diagnosticId: primaryError!.diagnosticId,
            message: primaryError!.message,
            retryable: primaryError!.retryable,
            stage: primaryError!.stage,
            recovery: primaryError!.recovery,
            details: { ...primaryError!.details, cleanupErrors },
          },
          lifecycle: outcomeFields,
        };
    const outcome: OperationOutcome = {
      status,
      command,
      subject: {
        adapter: String(d.adapter),
        capability: capability.id,
        device: {
          instance,
          physicalId: runtime.identity.physicalId,
        },
      },
      execution: {
        status,
        startedAt: new Date(started).toISOString(),
        endedAt: endedAt.toISOString(),
        durationMs,
        ...(run ? { runId: run.id } : {}),
        dryRun: false,
      },
      ...(output !== undefined ? { output } : {}),
      artifacts,
      result,
      primaryError,
      cleanupErrors,
      lockFinalStatus,
      quarantinedLock,
    };
    if (run) await runManager.finalize(run, outcome.status, outcome.result);
    options.onOutcome?.(outcome);
    session.transition("finalized");
    if (outcome.primaryError) {
      if (options.eventScope === "child")
        reporter?.emit("device.operation.failed", { outcome: outcome.result });
      else reporter?.emit("operation.failed", { outcome: outcome.result });
      throw Object.assign(outcome.primaryError, {
        result: outcome.result,
        outcome,
        operationTerminalReported: Boolean(reporter),
      });
    }
    if (options.eventScope === "child")
      reporter?.emit("device.operation.completed", { outcome: outcome.result });
    else reporter?.emit("operation.completed", { outcome: outcome.result });
    return outcome.result;
  }

  private async executeManagedSession(input: {
    instance: string;
    adapterId: string;
    runtime: DeviceRuntime;
    capability: Capability;
    plan: ManagedSessionPlan;
    input: Json;
    command: string;
    lockId: string;
    project: { root: string; config: string };
    approvalRequired: boolean;
    binding: Json;
    storedBinding: Json;
    options: OperationExecutionOptions;
  }): Promise<Json> {
    const starter = this.s.managedSessions;
    if (!starter)
      throw new BenchPilotError(
        "MANAGED_SESSION_RUNTIME_UNAVAILABLE",
        5,
        "Managed session runtime is not configured.",
      );
    const started = Date.now();
    const approvals = this.lifecycle.approvals(input.project.root);
    let claimedApproval: ApprovalRecord | undefined;
    let approvalLease: ApprovalLease | undefined;
    let primaryError: BenchPilotError | undefined;
    let record: import("../sessions/types.js").ManagedSessionRecord | undefined;
    let data: Json | undefined;
    try {
      if (input.approvalRequired) {
        const approval =
          (await approvals.findMatchingApproval(input.binding)) ||
          (await approvals.recoverMatchingStaleClaim(input.binding));
        if (!approval) {
          const requested = await approvals.request(
            input.binding,
            input.capability.safety.approvalTtlMs,
            input.storedBinding,
          );
          throw new BenchPilotError(
            "HUMAN_APPROVAL_REQUIRED",
            7,
            "Human approval is required before this operation can run.",
            false,
            undefined,
            [],
            { approvalId: requested.id },
          );
        }
        claimedApproval = await approvals.claim(input.binding);
        if (!claimedApproval)
          throw new BenchPilotError(
            "APPROVAL_ALREADY_CLAIMED",
            7,
            "Matching approval is no longer available.",
          );
        approvalLease = approvals.startClaimLease(claimedApproval);
      }
      const choice = <T extends string>(
        value: unknown,
        allowed: readonly T[],
      ): T | undefined =>
        typeof value === "string" && allowed.includes(value as T)
          ? (value as T)
          : undefined;
      const sessionId =
        typeof input.input.session_id === "string"
          ? input.input.session_id
          : undefined;
      if (input.plan.kind === "start") {
        const baud =
          typeof input.input.baud === "number" &&
          Number.isSafeInteger(input.input.baud)
            ? input.input.baud
            : undefined;
        record = await starter.start({
          projectRoot: input.project.root,
          command: input.command,
          capabilityId: input.capability.id,
          identity: input.runtime.identity,
          lockId: input.lockId,
          plan: input.plan,
          overrides: {
            baud,
            encoding: choice(input.input.encoding, ["utf8", "binary"]),
            lineFraming: choice(input.input.line_framing, ["line", "raw"]),
            dtr: choice(input.input.dtr, ["preserve", "off", "on"]),
            rts: choice(input.input.rts, ["preserve", "off", "on"]),
          },
          runContext: {
            adapter: input.adapterId,
            capability: input.capability.id,
            device: input.runtime.identity,
            physicalIdentity: input.runtime.identity,
            configDigest: sha(this.s.config.value),
            benchpilotVersion: this.s.defaults?.benchpilotVersion ?? "unknown",
            nodeVersion: process.version,
          },
        });
        data = {
          sessionId: record.id,
          status: record.state,
          runId: record.runId,
          startedAt: record.startedAt,
        };
      } else if (input.plan.kind === "stop") {
        record = await starter.stop({
          identity: input.runtime.identity,
          sessionId,
        });
        data = record
          ? {
              sessionId: record.id,
              status: record.state,
              stoppedAt: record.endedAt,
            }
          : { status: "not-running" };
      } else if (input.plan.kind === "logs") {
        record = await starter.find({
          identity: input.runtime.identity,
          sessionId,
        });
        const logs = await starter.logs({
          identity: input.runtime.identity,
          sessionId: record?.id ?? sessionId,
          tail:
            typeof input.input.tail === "number" ? input.input.tail : undefined,
          cursor:
            typeof input.input.cursor === "string"
              ? input.input.cursor
              : undefined,
        });
        data = {
          ...(record ? { sessionId: record.id, status: record.state } : {}),
          ...logs,
        };
      } else if (input.plan.kind === "send") {
        if (!sessionId)
          throw new BenchPilotError(
            "MANAGED_SESSION_ID_REQUIRED",
            2,
            "Managed session send requires a session ID.",
          );
        const values = [
          typeof input.input.text === "string" ? "text" : undefined,
          typeof input.input.hex === "string" ? "hex" : undefined,
          typeof input.input.base64 === "string" ? "base64" : undefined,
        ].filter(Boolean);
        if (values.length !== 1)
          throw new BenchPilotError(
            "MANAGED_SESSION_WRITE_INVALID",
            2,
            "Managed session send requires exactly one payload encoding.",
          );
        let bytes: Buffer;
        if (typeof input.input.text === "string")
          bytes = Buffer.from(input.input.text, "utf8");
        else if (typeof input.input.hex === "string") {
          if (
            input.input.hex.length % 2 !== 0 ||
            !/^[0-9a-fA-F]*$/.test(input.input.hex)
          )
            throw new BenchPilotError(
              "MANAGED_SESSION_WRITE_INVALID",
              2,
              "Managed session hexadecimal payload is invalid.",
            );
          bytes = Buffer.from(input.input.hex, "hex");
        } else {
          const value = String(input.input.base64);
          bytes = Buffer.from(value, "base64");
          if (!value || bytes.toString("base64") !== value)
            throw new BenchPilotError(
              "MANAGED_SESSION_WRITE_INVALID",
              2,
              "Managed session base64 payload is invalid.",
            );
        }
        const framing = choice(input.input.framing, ["line", "raw"]) ?? "line";
        if (framing === "line")
          bytes = Buffer.concat([bytes, Buffer.from("\n")]);
        const bytesWritten = await starter.write({ sessionId, data: bytes });
        data = {
          sessionId,
          status: "written",
          bytesWritten,
          framing,
          writtenAt: new Date().toISOString(),
        };
      } else if (input.plan.kind === "console") {
        const attach = input.options.attachManagedSessionConsole;
        if (!attach)
          throw new BenchPilotError(
            "INTERACTIVE_TERMINAL_REQUIRED",
            2,
            "Interactive terminal is required for this managed session capability.",
          );
        await attach({
          identity: input.runtime.identity,
          plan: input.plan,
          ...(sessionId ? { sessionId } : {}),
        });
        data = {};
      } else
        throw new BenchPilotError(
          "MANAGED_SESSION_CAPABILITY_NOT_READY",
          5,
          `Managed session capability ${input.capability.id} is not ready.`,
        );
      try {
        data = input.capability.outputSchema?.parse(data ?? {}) ?? data;
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
      if (claimedApproval) await approvals.consumeClaim(claimedApproval);
    } catch (error: unknown) {
      primaryError =
        error instanceof BenchPilotError
          ? error
          : new BenchPilotError(
              "MANAGED_SESSION_START_FAILED",
              5,
              error instanceof Error
                ? error.message
                : "Managed session could not start.",
            );
      if (claimedApproval)
        await approvals.releaseClaim(claimedApproval).catch(() => {});
    } finally {
      await approvalLease?.stop().catch(() => {});
    }
    const endedAt = new Date();
    const durationMs = Math.max(0, endedAt.getTime() - started);
    const execution = {
      startedAt: new Date(started).toISOString(),
      endedAt: endedAt.toISOString(),
      durationMs,
      ...(record?.runId ? { runId: record.runId } : {}),
      dryRun: false,
    };
    const output = data
      ? (input.capability.redactOutput?.(data) ?? data)
      : undefined;
    const result: Json = primaryError
      ? {
          schema: "benchpilot.operation-outcome",
          version: 1,
          status: "failed",
          command: input.command,
          subject: {
            adapter: input.adapterId,
            capability: input.capability.id,
            device: input.runtime.identity,
          },
          execution,
          error: {
            kind: primaryError.kind,
            diagnosticId: primaryError.diagnosticId,
            message: primaryError.message,
            retryable: primaryError.retryable,
            stage: primaryError.stage,
            recovery: primaryError.recovery,
            details: primaryError.details,
          },
          lifecycle: { lockFinalStatus: "session-owned", cleanupErrors: [] },
        }
      : {
          schema: "benchpilot.operation-outcome",
          version: 1,
          status: "succeeded",
          command: input.command,
          subject: {
            adapter: input.adapterId,
            capability: input.capability.id,
            device: input.runtime.identity,
          },
          execution,
          output,
          artifacts: [],
          lifecycle: { lockFinalStatus: "session-owned", cleanupErrors: [] },
        };
    const outcome: OperationOutcome = {
      status: primaryError ? "failed" : "succeeded",
      command: input.command,
      subject: {
        adapter: input.adapterId,
        capability: input.capability.id,
        device: {
          instance: input.instance,
          physicalId: input.runtime.identity.physicalId,
        },
      },
      execution: {
        status: primaryError ? "failed" : "succeeded",
        ...execution,
      },
      ...(output ? { output } : {}),
      artifacts: [],
      result,
      primaryError,
      cleanupErrors: [],
      lockFinalStatus: "not-required",
    };
    input.options.onOutcome?.(outcome);
    if (primaryError) throw Object.assign(primaryError, { result, outcome });
    return result;
  }

  private requireProject(): { root: string; config: string } {
    if (!this.s.project)
      fail(
        "PROJECT_NOT_FOUND",
        3,
        "A BenchPilot project is required for persistent operation state.",
      );
    return this.s.project!;
  }
}
