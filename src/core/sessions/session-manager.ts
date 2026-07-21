import { randomBytes, timingSafeEqual } from "node:crypto";
import { BenchPilotError } from "../errors/benchpilot-error.js";
import { withFileGuard } from "../concurrency/file-guard.js";
import { PathService } from "../paths/path-service.js";
import { ManagedSessionStore } from "./session-store.js";
import type {
  CreateManagedSessionInput,
  ManagedSessionControlRecord,
  ManagedSessionFailure,
  ManagedSessionLaunchPermit,
  ManagedSessionRecord,
  ManagedSessionRunningUpdate,
  ManagedSessionStartClaim,
  ManagedSessionState,
} from "./types.js";

const transitions: Readonly<
  Record<ManagedSessionState, readonly ManagedSessionState[]>
> = {
  creating: ["starting", "failed"],
  starting: ["running", "stopping", "failed"],
  running: ["stopping", "failed"],
  stopping: ["stopped", "failed"],
  stopped: [],
  failed: [],
};

const token = () => randomBytes(32).toString("hex");

const matchesToken = (actual: string, expected: string) => {
  const left = Buffer.from(actual, "utf8");
  const right = Buffer.from(expected, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
};

/**
 * Owns only durable session metadata and authentication material. The future
 * host owns the serial transport, device lock, long-lived Run and RLog.
 */
export class ManagedSessionManager {
  readonly store: ManagedSessionStore;

  constructor(paths: PathService) {
    this.store = new ManagedSessionStore(paths);
  }

  async create(input: CreateManagedSessionInput): Promise<{
    record: ManagedSessionRecord;
    permit: ManagedSessionLaunchPermit;
  }> {
    if (
      !input.projectRoot ||
      !input.capabilityId ||
      !input.identity.adapter ||
      !input.identity.instance ||
      !input.identity.physicalId
    )
      throw new BenchPilotError(
        "INVALID_MANAGED_SESSION",
        2,
        "Managed session identity and project root are required.",
      );
    for (;;) {
      const id = `session-${Date.now().toString(36)}-${randomBytes(8).toString("hex")}`;
      const now = new Date().toISOString();
      const controlToken = token();
      const handshakeToken = token();
      const record: ManagedSessionRecord = {
        schema: "benchpilot.managed-session",
        version: 1,
        id,
        state: "creating",
        revision: 0,
        createdAt: now,
        updatedAt: now,
        projectRoot: input.projectRoot,
        capabilityId: input.capabilityId,
        identity: { ...input.identity },
      };
      const control: ManagedSessionControlRecord = {
        schema: "benchpilot.managed-session-control",
        version: 1,
        sessionId: id,
        controlToken,
        handshakeToken,
        createdAt: now,
      };
      try {
        await this.store.create(record, control);
        return {
          record,
          permit: { sessionId: id, controlToken, handshakeToken },
        };
      } catch (error: unknown) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
    }
  }

  get(sessionId: string) {
    return this.store.read(sessionId);
  }

  list() {
    return this.store.list();
  }

  async claimStart(
    input: ManagedSessionStartClaim,
  ): Promise<ManagedSessionRecord> {
    return this.update(input.sessionId, async (record, control) => {
      this.requireToken(
        control.handshakeToken,
        input.handshakeToken,
        "handshake",
      );
      this.requireRevision(record, input.expectedRevision);
      return this.transition(record, "starting", { ownerPid: input.ownerPid });
    });
  }

  async markRunning(
    input: ManagedSessionRunningUpdate,
  ): Promise<ManagedSessionRecord> {
    return this.update(input.sessionId, async (record, control) => {
      this.requireToken(control.controlToken, input.controlToken, "control");
      this.requireRevision(record, input.expectedRevision);
      return this.transition(record, "running", {
        runId: input.runId,
        lockId: input.lockId,
        controlEndpoint: input.controlEndpoint,
        startedAt: new Date().toISOString(),
      });
    });
  }

  /** Stop is deliberately idempotent; revision guards only protect updates. */
  async requestStop(
    sessionId: string,
    controlToken: string,
  ): Promise<ManagedSessionRecord> {
    return this.update(sessionId, async (record, control) => {
      this.requireToken(control.controlToken, controlToken, "control");
      if (record.state === "stopping" || record.state === "stopped")
        return record;
      if (record.state === "failed") return record;
      if (record.state === "creating")
        throw new BenchPilotError(
          "MANAGED_SESSION_NOT_STARTED",
          4,
          `Managed session has not started: ${sessionId}.`,
          true,
        );
      return this.transition(record, "stopping");
    });
  }

  async markStopped(
    sessionId: string,
    controlToken: string,
    expectedRevision: number,
  ): Promise<ManagedSessionRecord> {
    return this.update(sessionId, async (record, control) => {
      this.requireToken(control.controlToken, controlToken, "control");
      this.requireRevision(record, expectedRevision);
      return this.transition(record, "stopped", {
        endedAt: new Date().toISOString(),
      });
    });
  }

  async markFailed(
    sessionId: string,
    credential: { controlToken?: string; handshakeToken?: string },
    failure: ManagedSessionFailure,
  ): Promise<ManagedSessionRecord> {
    return this.update(sessionId, async (record, control) => {
      const supplied = credential.controlToken ?? credential.handshakeToken;
      const expected = credential.controlToken
        ? control.controlToken
        : control.handshakeToken;
      this.requireToken(expected, supplied, "control");
      if (record.state === "failed") return record;
      if (record.state === "stopped")
        throw new BenchPilotError(
          "MANAGED_SESSION_TERMINAL",
          4,
          `Managed session is already stopped: ${sessionId}.`,
        );
      return this.transition(record, "failed", {
        endedAt: new Date().toISOString(),
        failure: { ...failure },
      });
    });
  }

  private async update(
    sessionId: string,
    action: (
      record: ManagedSessionRecord,
      control: ManagedSessionControlRecord,
    ) => Promise<ManagedSessionRecord> | ManagedSessionRecord,
  ) {
    return withFileGuard(
      this.store.guardFile(sessionId),
      {
        resourceType: "session-update",
        resourceId: sessionId,
        busyKind: "MANAGED_SESSION_BUSY",
      },
      async () => {
        const record = await this.requireRecord(sessionId);
        const control = await this.requireControl(sessionId);
        const updated = await action(record, control);
        if (updated !== record) await this.store.write(updated);
        return updated;
      },
    );
  }

  private async requireRecord(sessionId: string) {
    const record = await this.store.read(sessionId);
    if (record) return record;
    throw new BenchPilotError(
      "MANAGED_SESSION_NOT_FOUND",
      3,
      `Managed session was not found: ${sessionId}.`,
    );
  }

  private async requireControl(sessionId: string) {
    const control = await this.store.readControl(sessionId);
    if (control) return control;
    throw new BenchPilotError(
      "MANAGED_SESSION_CORRUPT",
      5,
      `Managed session control record is missing: ${sessionId}.`,
    );
  }

  private requireToken(
    expected: string,
    supplied: string | undefined,
    kind: string,
  ) {
    if (!supplied || !matchesToken(expected, supplied))
      throw new BenchPilotError(
        "MANAGED_SESSION_AUTH_FAILED",
        4,
        `Managed session ${kind} authentication failed.`,
      );
  }

  private requireRevision(
    record: ManagedSessionRecord,
    expectedRevision: number,
  ) {
    if (record.revision !== expectedRevision)
      throw new BenchPilotError(
        "MANAGED_SESSION_REVISION_CONFLICT",
        4,
        `Managed session state changed before the requested transition.`,
        true,
        undefined,
        [],
        {
          sessionId: record.id,
          expectedRevision,
          actualRevision: record.revision,
        },
      );
  }

  private transition(
    record: ManagedSessionRecord,
    next: ManagedSessionState,
    fields: Partial<ManagedSessionRecord> = {},
  ): ManagedSessionRecord {
    if (!transitions[record.state].includes(next))
      throw new BenchPilotError(
        "MANAGED_SESSION_STATE_INVALID",
        5,
        `Cannot transition managed session ${record.id} from ${record.state} to ${next}.`,
      );
    return {
      ...record,
      ...fields,
      state: next,
      revision: record.revision + 1,
      updatedAt: new Date().toISOString(),
    };
  }
}
