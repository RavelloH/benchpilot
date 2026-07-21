import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  BenchPilotError,
  type ManagedSessionHostLaunch,
  ManagedSessionManager,
  type ManagedSessionRecord,
  type ManagedSessionStartRequest,
  type ManagedSessionStarter,
  ManagedSessionReconciler,
  PathService,
} from "../core.js";
import type { SerialPortSessionTransportOptions } from "./serialport-session-transport.js";
import { requestManagedSessionControl } from "../core/sessions/session-control.js";
import { readManagedSessionLog } from "../core/sessions/session-log-reader.js";

interface SerialSessionHostLaunch {
  readonly schema: "benchpilot.serial-session-host-launch";
  readonly version: 1;
  readonly host: ManagedSessionHostLaunch;
  readonly serial: SerialPortSessionTransportOptions;
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const hostEntry = () => {
  const current = fileURLToPath(import.meta.url);
  const extension = path.extname(current);
  return path.join(path.dirname(current), `session-host-entry${extension}`);
};

export interface SerialSessionLauncherOptions {
  /** Internal test hook for exercising the detached-host handshake. */
  readonly hostEntry?: string;
  readonly readyTimeoutMs?: number;
  /** The detached host must receive the same runtime-root environment. */
  readonly environment?: NodeJS.ProcessEnv;
}

/** Starts a detached host and returns only after its public ready state exists. */
export class SerialSessionLauncher implements ManagedSessionStarter {
  readonly sessions: ManagedSessionManager;

  constructor(
    private readonly paths: PathService,
    private readonly options: SerialSessionLauncherOptions = {},
  ) {
    this.sessions = new ManagedSessionManager(paths);
  }

  async start(
    input: ManagedSessionStartRequest,
  ): Promise<ManagedSessionRecord> {
    await new ManagedSessionReconciler(this.paths).reconcile();
    const { record, permit } = await this.sessions.create({
      projectRoot: input.projectRoot,
      capabilityId: input.capabilityId,
      identity: input.identity,
    });
    const launch: SerialSessionHostLaunch = {
      schema: "benchpilot.serial-session-host-launch",
      version: 1,
      host: {
        permit,
        command: input.command,
        lockId: input.lockId,
        lockIdentity: {
          adapter: input.identity.adapter,
          kind: "device",
          physicalId: input.identity.physicalId,
        },
        runContext: input.runContext,
        log: {
          encoding: input.overrides.encoding ?? input.plan.encoding,
          lineFraming: input.overrides.lineFraming ?? input.plan.lineFraming,
          logRecordLimit: input.plan.logRecordLimit,
          spoolLimitBytes: input.plan.spoolLimitBytes,
          rawCaptureLimitBytes: input.plan.rawCaptureLimitBytes,
        },
        writeLimitBytes: input.plan.writeLimitBytes,
      },
      serial: {
        path: input.plan.port,
        baudRate: input.overrides.baud ?? input.plan.baud,
        dtr: input.overrides.dtr ?? input.plan.openLinePolicy.dtr,
        rts: input.overrides.rts ?? input.plan.openLinePolicy.rts,
      },
    };
    await this.sessions.store.writeLaunch(record.id, launch);
    const child = spawn(
      process.execPath,
      [
        ...process.execArgv,
        this.options.hostEntry ?? hostEntry(),
        "--session-id",
        record.id,
      ],
      {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
        env: this.options.environment ?? process.env,
      },
    );
    child.unref();
    const timeoutMs = this.options.readyTimeoutMs ?? 15_000;
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const current = await this.sessions.get(record.id);
      if (current?.state === "running") return current;
      if (current?.state === "failed")
        throw new BenchPilotError(
          "MANAGED_SESSION_HOST_FAILED",
          5,
          current.failure?.message ?? "Managed session host failed to start.",
        );
      if (Date.now() >= deadline) {
        const timeoutError = new BenchPilotError(
          "MANAGED_SESSION_READY_TIMEOUT",
          4,
          "Managed session host did not become ready in time.",
          true,
        );
        child.kill("SIGTERM");
        await this.sessions
          .markFailed(
            record.id,
            { controlToken: permit.controlToken },
            { kind: timeoutError.kind, message: timeoutError.message },
          )
          .catch(() => {});
        throw timeoutError;
      }
      await delay(25);
    }
  }

  async write(input: { sessionId: string; data: Uint8Array }) {
    const { record, controlToken, leaseId } = await this.acquireWriterLease(
      input.sessionId,
    );
    try {
      return await this.writeWithLease({
        sessionId: record.id,
        controlToken,
        leaseId,
        data: input.data,
      });
    } finally {
      await this.releaseWriterLease({ record, controlToken, leaseId }).catch(
        () => {},
      );
    }
  }

  async acquireWriterLease(sessionId: string) {
    const record = await this.sessions.get(sessionId);
    if (!record?.controlEndpoint)
      throw new BenchPilotError(
        "SESSION_CONTROL_UNAVAILABLE",
        4,
        "Managed session control endpoint is unavailable.",
        true,
      );
    const controlToken = await this.sessions.controlToken(record.id);
    const leaseId = await this.acquireWriter(record, controlToken);
    return { record, controlToken, leaseId };
  }

  async writeWithLease(input: {
    sessionId: string;
    controlToken: string;
    leaseId: string;
    data: Uint8Array;
  }) {
    const record = await this.sessions.get(input.sessionId);
    if (!record?.controlEndpoint)
      throw new BenchPilotError(
        "SESSION_CONTROL_UNAVAILABLE",
        4,
        "Managed session control endpoint is unavailable.",
        true,
      );
    const response = await requestManagedSessionControl(
      record.controlEndpoint,
      {
        schema: "benchpilot.managed-session-control-request",
        version: 1,
        type: "write",
        sessionId: record.id,
        controlToken: input.controlToken,
        leaseId: input.leaseId,
        dataBase64: Buffer.from(input.data).toString("base64"),
      },
    );
    if (!response.ok)
      throw new BenchPilotError(
        response.error?.kind ?? "SESSION_CONTROL_FAILED",
        5,
        response.error?.message ?? "Managed session write failed.",
      );
    return Number(response.result?.bytesWritten ?? 0);
  }

  async renewWriterLease(input: {
    sessionId: string;
    controlToken: string;
    leaseId: string;
  }) {
    const record = await this.sessions.get(input.sessionId);
    if (!record?.controlEndpoint)
      throw new BenchPilotError(
        "SESSION_CONTROL_UNAVAILABLE",
        4,
        "Managed session control endpoint is unavailable.",
        true,
      );
    const response = await requestManagedSessionControl(
      record.controlEndpoint,
      {
        schema: "benchpilot.managed-session-control-request",
        version: 1,
        type: "renew-writer",
        sessionId: record.id,
        controlToken: input.controlToken,
        leaseId: input.leaseId,
      },
    );
    if (!response.ok)
      throw new BenchPilotError(
        response.error?.kind ?? "SESSION_CONTROL_FAILED",
        5,
        response.error?.message ??
          "Managed session writer lease renewal failed.",
      );
  }

  async releaseWriterLease(input: {
    record: ManagedSessionRecord;
    controlToken: string;
    leaseId: string;
  }) {
    if (!input.record.controlEndpoint) return;
    const response = await requestManagedSessionControl(
      input.record.controlEndpoint,
      {
        schema: "benchpilot.managed-session-control-request",
        version: 1,
        type: "release-writer",
        sessionId: input.record.id,
        controlToken: input.controlToken,
        leaseId: input.leaseId,
      },
    );
    if (!response.ok)
      throw new BenchPilotError(
        response.error?.kind ?? "SESSION_CONTROL_FAILED",
        5,
        response.error?.message ??
          "Managed session writer lease release failed.",
      );
  }

  private async acquireWriter(
    record: ManagedSessionRecord,
    controlToken: string,
  ) {
    const response = await requestManagedSessionControl(
      record.controlEndpoint!,
      {
        schema: "benchpilot.managed-session-control-request",
        version: 1,
        type: "acquire-writer",
        sessionId: record.id,
        controlToken,
      },
    );
    if (!response.ok)
      throw new BenchPilotError(
        response.error?.kind ?? "SESSION_CONTROL_FAILED",
        5,
        response.error?.message ?? "Managed session writer lease failed.",
      );
    const leaseId = response.result?.leaseId;
    if (typeof leaseId !== "string")
      throw new BenchPilotError(
        "SESSION_CONTROL_PROTOCOL",
        5,
        "Managed session writer lease response is invalid.",
      );
    return leaseId;
  }

  async find(input: {
    identity: ManagedSessionStartRequest["identity"];
    sessionId?: string;
    activeOnly?: boolean;
  }) {
    const matches = (record: ManagedSessionRecord) =>
      record.identity.adapter === input.identity.adapter &&
      record.identity.instance === input.identity.instance &&
      record.identity.physicalId === input.identity.physicalId;
    if (input.sessionId) {
      const record = await this.sessions.get(input.sessionId);
      if (!record || !matches(record)) return undefined;
      return input.activeOnly && !this.active(record) ? undefined : record;
    }
    return (await this.sessions.list()).find(
      (record) => matches(record) && (!input.activeOnly || this.active(record)),
    );
  }

  async stop(input: {
    identity: ManagedSessionStartRequest["identity"];
    sessionId?: string;
  }) {
    const record = await this.find(input);
    if (!record) return undefined;
    if (record.state === "stopped" || record.state === "failed") return record;
    if (!record.controlEndpoint)
      throw new BenchPilotError(
        "SESSION_CONTROL_UNAVAILABLE",
        4,
        "Managed session control endpoint is unavailable.",
        true,
      );
    const response = await requestManagedSessionControl(
      record.controlEndpoint,
      {
        schema: "benchpilot.managed-session-control-request",
        version: 1,
        type: "stop",
        sessionId: record.id,
        controlToken: await this.sessions.controlToken(record.id),
      },
    );
    if (!response.ok)
      throw new BenchPilotError(
        response.error?.kind ?? "SESSION_CONTROL_FAILED",
        5,
        response.error?.message ?? "Managed session stop failed.",
      );
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      const current = await this.sessions.get(record.id);
      if (current?.state === "stopped" || current?.state === "failed")
        return current;
      await delay(25);
    }
    throw new BenchPilotError(
      "MANAGED_SESSION_STOP_TIMEOUT",
      4,
      "Managed session did not stop in time.",
      true,
    );
  }

  async logs(input: {
    identity: ManagedSessionStartRequest["identity"];
    sessionId?: string;
    tail?: number;
    cursor?: string;
  }) {
    const record = await this.find({
      identity: input.identity,
      sessionId: input.sessionId,
    });
    if (!record)
      throw new BenchPilotError(
        "MANAGED_SESSION_NOT_FOUND",
        3,
        "Managed session was not found.",
      );
    return readManagedSessionLog(this.paths, record, input);
  }

  async *follow(input: {
    identity: ManagedSessionStartRequest["identity"];
    sessionId?: string;
    tail?: number;
    cursor?: string;
    signal: AbortSignal;
  }) {
    let cursor = input.cursor;
    while (!input.signal.aborted) {
      const logs = await this.logs({ ...input, cursor });
      cursor = logs.cursor ?? cursor;
      for (const record of logs.records) yield record;
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 100);
        input.signal.addEventListener(
          "abort",
          () => {
            clearTimeout(timer);
            resolve();
          },
          { once: true },
        );
      });
    }
    return cursor;
  }

  private active(record: ManagedSessionRecord) {
    return ["creating", "starting", "running", "stopping"].includes(
      record.state,
    );
  }
}
