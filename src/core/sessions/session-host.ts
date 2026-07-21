import { randomBytes } from "node:crypto";
import { BenchPilotError } from "../errors/benchpilot-error.js";
import type { PhysicalResourceIdentity } from "../locks/lock-identity.js";
import type { LockLease, LockRecord } from "../locks/types.js";
import type { LockManager } from "../locks/lock-manager.js";
import type {
  BusinessLog,
  BusinessLogFactory,
} from "../reporting/business-log.js";
import type { Run, RunManager } from "../runs/run-manager.js";
import type { Json } from "../config/config.js";
import {
  managedSessionControlEndpoint,
  ManagedSessionControlServer,
} from "./session-control.js";
import { ManagedSessionManager } from "./session-manager.js";
import { ManagedSessionLogSpool } from "./session-log-spool.js";
import type {
  ManagedSessionLaunchPermit,
  ManagedSessionRecord,
} from "./types.js";

export interface ManagedSessionTransport {
  open(): Promise<void>;
  close(): Promise<void>;
  write(data: Uint8Array): Promise<number>;
  onData(listener: (chunk: Uint8Array) => void): () => void;
  /** Resolves only when the transport exits outside the host's stop sequence. */
  readonly closed?: Promise<void>;
}

export interface ManagedSessionHostLaunch {
  readonly permit: ManagedSessionLaunchPermit;
  readonly command: string;
  readonly lockId: string;
  readonly lockIdentity: PhysicalResourceIdentity;
  readonly runContext: Json;
  readonly log: {
    readonly encoding: "utf8" | "binary";
    readonly lineFraming: "line" | "raw";
    readonly logRecordLimit: number;
    readonly spoolLimitBytes: number;
    readonly rawCaptureLimitBytes: number;
  };
  readonly writeLimitBytes: number;
}

export interface ManagedSessionHostDependencies {
  readonly sessions: ManagedSessionManager;
  readonly locks: LockManager;
  readonly runs: RunManager;
  readonly businessLogs: BusinessLogFactory;
  readonly createTransport: () => Promise<ManagedSessionTransport>;
  readonly lockHeartbeatIntervalMs?: number;
  readonly lockLeaseMs?: number;
  readonly onReady?: (record: ManagedSessionRecord) => Promise<void> | void;
}

type CleanupError = {
  readonly name: string;
  readonly holdsPhysicalResource: boolean;
  readonly message: string;
};

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
};

/**
 * Long-lived resource owner for one managed session. It intentionally does not
 * use OperationRunner: its Run, Lock lease and RLog must outlive the short
 * request that started the host.
 */
export class ManagedSessionHost {
  private readonly stop = deferred<void>();
  private stopping = false;
  private writeChain = Promise.resolve(0);
  private writerLease: { readonly id: string; expiresAt: number } | undefined;

  constructor(
    private readonly launch: ManagedSessionHostLaunch,
    private readonly dependencies: ManagedSessionHostDependencies,
  ) {}

  async run(): Promise<ManagedSessionRecord> {
    const { sessions, locks, runs, businessLogs } = this.dependencies;
    const { permit } = this.launch;
    let run: Run | undefined;
    let logger: BusinessLog | undefined;
    let lock: LockRecord | undefined;
    let lease: LockLease | undefined;
    let transport: ManagedSessionTransport | undefined;
    let control: ManagedSessionControlServer | undefined;
    let spool: ManagedSessionLogSpool | undefined;
    let detachTransport: (() => void) | undefined;
    let primaryError: Error | undefined;
    const cleanupErrors: CleanupError[] = [];
    let lockFinalStatus: "not-acquired" | "released" | "quarantined" =
      "not-acquired";
    let quarantinedLock = false;

    const cleanup = async (
      name: string,
      holdsPhysicalResource: boolean,
      action: () => Promise<void>,
    ) => {
      try {
        await action();
      } catch (error: unknown) {
        cleanupErrors.push({
          name,
          holdsPhysicalResource,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    };

    const onSignal = (signal: "SIGINT" | "SIGTERM") => {
      if (!primaryError)
        primaryError = new BenchPilotError(
          "MANAGED_SESSION_HOST_ABORTED",
          6,
          `Managed session host received ${signal}.`,
        );
      this.stop.resolve();
    };
    const onSigint = () => onSignal("SIGINT");
    const onSigterm = () => onSignal("SIGTERM");
    process.once("SIGINT", onSigint);
    process.once("SIGTERM", onSigterm);

    try {
      const initial = await sessions.get(permit.sessionId);
      if (!initial)
        throw new BenchPilotError(
          "MANAGED_SESSION_NOT_FOUND",
          3,
          `Managed session was not found: ${permit.sessionId}.`,
        );
      const starting = await sessions.claimStart({
        sessionId: permit.sessionId,
        handshakeToken: permit.handshakeToken,
        expectedRevision: initial.revision,
        ownerPid: process.pid,
      });
      run = await runs.create(this.launch.command, {
        ...this.launch.runContext,
        sessionId: permit.sessionId,
      });
      logger = businessLogs.open({
        logFilePath: `${run.dir}/benchpilot.log`,
        jsonlFilePath: `${run.dir}/events.jsonl`,
        context: {
          runId: run.id,
          command: this.launch.command,
          sessionId: permit.sessionId,
        },
      });
      logger.event("session.host.started", { sessionId: permit.sessionId });
      lock = await locks.acquire(
        this.launch.lockId,
        this.launch.command,
        run.id,
        this.launch.lockIdentity,
        permit.sessionId,
      );
      lease = locks.startHeartbeat(
        lock,
        this.dependencies.lockHeartbeatIntervalMs,
        this.dependencies.lockLeaseMs,
      );
      transport = await this.dependencies.createTransport();
      await transport.open();
      spool = new ManagedSessionLogSpool({
        run,
        ...this.launch.log,
        onRecord: (record) =>
          logger?.event("session.log.record", {
            sessionId: permit.sessionId,
            sequence: record.sequence,
            encodingState: record.encodingState,
          }),
      });
      await spool.open();
      detachTransport = transport.onData((chunk) => {
        void spool?.append(chunk).catch(() => {});
      });
      const endpoint = managedSessionControlEndpoint(
        sessions.store.paths,
        permit.sessionId,
      );
      control = new ManagedSessionControlServer({
        endpoint,
        handle: async (request) => {
          if (request.sessionId !== permit.sessionId)
            throw new BenchPilotError(
              "SESSION_CONTROL_SESSION_MISMATCH",
              4,
              "Control request targets another managed session.",
            );
          if (request.type === "stop") {
            const record = await sessions.requestStop(
              request.sessionId,
              request.controlToken,
            );
            this.stopping = true;
            this.stop.resolve();
            return { sessionId: record.id, state: record.state };
          }
          await sessions.authorizeControl(
            request.sessionId,
            request.controlToken,
          );
          if (request.type === "acquire-writer") {
            this.expireWriterLease();
            if (this.writerLease)
              throw new BenchPilotError(
                "MANAGED_SESSION_WRITER_BUSY",
                4,
                "Managed session already has an active writer.",
                true,
              );
            const leaseId = randomBytes(24).toString("hex");
            this.writerLease = {
              id: leaseId,
              expiresAt: Date.now() + 30_000,
            };
            return { sessionId: permit.sessionId, leaseId };
          }
          if (request.type === "renew-writer") {
            this.requireWriterLease(request.leaseId);
            this.writerLease!.expiresAt = Date.now() + 30_000;
            return { sessionId: permit.sessionId, leaseId: request.leaseId };
          }
          if (request.type === "release-writer") {
            this.requireWriterLease(request.leaseId);
            this.writerLease = undefined;
            return { sessionId: permit.sessionId, released: true };
          }
          this.requireWriterLease(request.leaseId);
          this.writerLease!.expiresAt = Date.now() + 30_000;
          const data = Buffer.from(request.dataBase64, "base64");
          if (
            !request.dataBase64 ||
            data.toString("base64") !== request.dataBase64 ||
            data.byteLength > this.launch.writeLimitBytes
          )
            throw new BenchPilotError(
              "MANAGED_SESSION_WRITE_INVALID",
              2,
              "Managed session write payload is invalid or exceeds its limit.",
            );
          const previous = this.writeChain.catch(() => 0);
          this.writeChain = previous.then(async () => transport!.write(data));
          const bytesWritten = await this.writeChain;
          logger?.event("session.write", {
            sessionId: permit.sessionId,
            bytesWritten,
          });
          return { sessionId: permit.sessionId, bytesWritten };
        },
      });
      await control.listen();
      const running = await sessions.markRunning({
        sessionId: permit.sessionId,
        controlToken: permit.controlToken,
        expectedRevision: starting.revision,
        runId: run.id,
        lockId: lock.lockId,
        controlEndpoint: endpoint,
      });
      logger.event("session.host.ready", {
        sessionId: permit.sessionId,
        runId: run.id,
        lockId: lock.lockId,
      });
      await this.dependencies.onReady?.(running);
      const transportClosed = transport.closed
        ? transport.closed.then(() => {
            if (!this.stopping)
              throw new BenchPilotError(
                "MANAGED_SESSION_TRANSPORT_CLOSED",
                5,
                "Managed session transport closed unexpectedly.",
              );
          })
        : new Promise<never>(() => {});
      const lockLost = lease.lost.then((error) => {
        throw error;
      });
      await Promise.race([
        this.stop.promise,
        transportClosed,
        lockLost,
        spool.failed,
      ]);
    } catch (error: unknown) {
      primaryError =
        error instanceof Error
          ? error
          : new BenchPilotError(
              "MANAGED_SESSION_HOST_FAILED",
              5,
              "Managed session host failed.",
            );
    } finally {
      process.removeListener("SIGINT", onSigint);
      process.removeListener("SIGTERM", onSigterm);
      if (control)
        await cleanup("session-control", false, () => control!.close());
      detachTransport?.();
      this.writerLease = undefined;
      if (transport)
        await cleanup("session-transport", true, () => transport!.close());
      if (spool)
        await cleanup("session-log-spool", false, () => spool!.close());
      if (lease) await cleanup("lock-heartbeat", true, () => lease!.stop());
      const physicalCleanupUnsafe = cleanupErrors.some(
        (error) => error.holdsPhysicalResource,
      );
      if (lock) {
        if (physicalCleanupUnsafe) {
          await cleanup("lock-quarantine", true, async () => {
            await locks.quarantine(lock!, {
              kind: "SESSION_CLEANUP_FAILED",
              message: "Managed session physical cleanup failed.",
              cleanupErrors: cleanupErrors.map((error) => ({
                ...error,
                critical: error.holdsPhysicalResource,
                timedOut: false,
              })),
              runId: run?.id,
            });
            lockFinalStatus = "quarantined";
            quarantinedLock = true;
          });
        } else {
          await cleanup("lock-release", true, async () => {
            await locks.release(lock!);
            lockFinalStatus = "released";
          });
        }
      }
      if (logger) await cleanup("logger-close", false, () => logger!.close());
      const sessionFailure = primaryError || cleanupErrors.length > 0;
      if (run)
        await cleanup("run-finalization", false, () =>
          runs.finalize(run!, sessionFailure ? "failed" : "succeeded", {
            schema: "benchpilot.managed-session-outcome",
            version: 1,
            sessionId: permit.sessionId,
            status: sessionFailure ? "failed" : "succeeded",
            ...(primaryError
              ? {
                  error: {
                    kind:
                      primaryError instanceof BenchPilotError
                        ? primaryError.kind
                        : "MANAGED_SESSION_HOST_FAILED",
                    message: primaryError.message,
                  },
                }
              : {}),
            lifecycle: { cleanupErrors, lockFinalStatus },
          }),
        );
      const current = await sessions.get(permit.sessionId);
      if (current) {
        if (sessionFailure)
          await sessions.markFailed(
            permit.sessionId,
            { controlToken: permit.controlToken },
            {
              kind:
                primaryError instanceof BenchPilotError
                  ? primaryError.kind
                  : "MANAGED_SESSION_HOST_FAILED",
              message:
                primaryError?.message ??
                "Managed session cleanup did not complete.",
              quarantinedLock,
            },
          );
        else
          await sessions.markStopped(
            permit.sessionId,
            permit.controlToken,
            current.revision,
          );
      }
    }
    const final = await sessions.get(permit.sessionId);
    if (!final)
      throw new BenchPilotError(
        "MANAGED_SESSION_NOT_FOUND",
        3,
        `Managed session was not found: ${permit.sessionId}.`,
      );
    if (primaryError) throw primaryError;
    return final;
  }

  private expireWriterLease() {
    if (this.writerLease && this.writerLease.expiresAt <= Date.now())
      this.writerLease = undefined;
  }

  private requireWriterLease(leaseId: string) {
    this.expireWriterLease();
    if (!this.writerLease || this.writerLease.id !== leaseId)
      throw new BenchPilotError(
        "MANAGED_SESSION_WRITER_LEASE_INVALID",
        4,
        "Managed session writer lease is unavailable or expired.",
        true,
      );
  }
}
