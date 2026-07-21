import os from "node:os";
import { BenchPilotError } from "../errors/benchpilot-error.js";
import { LockManager } from "../locks/lock-manager.js";
import { PathService } from "../paths/path-service.js";
import { RunManager } from "../runs/run-manager.js";
import { ManagedSessionManager } from "./session-manager.js";
import type { ManagedSessionRecord } from "./types.js";

export type ManagedSessionOwnerLiveness = "active" | "stale" | "unknown";

export const managedSessionOwnerLiveness = (
  record: ManagedSessionRecord,
): ManagedSessionOwnerLiveness => {
  if (!record.ownerPid || !record.ownerHostname) return "unknown";
  if (record.ownerHostname !== os.hostname()) return "unknown";
  try {
    process.kill(record.ownerPid, 0);
    return "active";
  } catch (error: unknown) {
    return (error as NodeJS.ErrnoException).code === "ESRCH"
      ? "stale"
      : "unknown";
  }
};

/**
 * Recovers only hosts proven dead on this machine. Session hosts own no child
 * serial process, so a stale host PID proves that its native serial handle has
 * been closed by the operating system. Unknown ownership is intentionally left
 * locked for explicit operator recovery.
 */
export class ManagedSessionReconciler {
  readonly sessions: ManagedSessionManager;
  readonly locks: LockManager;

  constructor(private readonly paths: PathService) {
    this.sessions = new ManagedSessionManager(paths);
    this.locks = new LockManager(paths);
  }

  async inspect() {
    return Promise.all(
      (await this.sessions.list()).map(async (record) => ({
        record,
        liveness: managedSessionOwnerLiveness(record),
      })),
    );
  }

  async reconcile() {
    const reconciled: string[] = [];
    const unresolved: string[] = [];
    for (const record of await this.sessions.list()) {
      if (!["starting", "running", "stopping"].includes(record.state)) continue;
      if (managedSessionOwnerLiveness(record) !== "stale") continue;
      let cleared = !record.lockId;
      if (record.lockId) {
        try {
          const lock = await this.locks.inspect(record.lockId);
          if ((await this.locks.liveness(lock)) === "stale") {
            await this.locks.clear(record.lockId);
            cleared = true;
          }
        } catch (error: unknown) {
          if ((error as BenchPilotError).kind === "LOCK_NOT_FOUND")
            cleared = true;
        }
      }
      const controlToken = await this.sessions.controlToken(record.id);
      await this.sessions.markFailed(
        record.id,
        { controlToken },
        {
          kind: cleared
            ? "MANAGED_SESSION_HOST_STALE"
            : "MANAGED_SESSION_LOCK_UNRESOLVED",
          message: cleared
            ? "Managed session host exited unexpectedly."
            : "Managed session host exited but its lock could not be verified stale.",
          quarantinedLock: !cleared,
        },
      );
      const current = await this.sessions.get(record.id);
      if (record.runId) {
        const runs = new RunManager(this.paths, record.projectRoot);
        const stored = await runs.get(record.runId).catch(() => undefined);
        if (stored) {
          const started = Date.parse(String(stored.manifest?.startedAt ?? ""));
          await runs.finalize(
            {
              id: record.runId,
              dir: stored.dir,
              started: Number.isFinite(started) ? started : Date.now(),
              command: String(stored.manifest?.command ?? "device.run"),
            },
            "failed",
            {
              schema: "benchpilot.managed-session-outcome",
              version: 1,
              sessionId: record.id,
              status: "failed",
              error: current?.failure,
            },
          );
        }
      }
      if (cleared) reconciled.push(record.id);
      else unresolved.push(record.id);
    }
    return { reconciled, unresolved };
  }
}
