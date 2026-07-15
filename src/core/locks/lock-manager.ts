import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { BenchPilotError, fail } from "../errors/benchpilot-error.js";
import { PathService } from "../paths/path-service.js";
import { atomicJson, readJson } from "../utilities/atomic-json.js";
import { resolveInside } from "../utilities/resolve-inside.js";
import type { PhysicalResourceIdentity } from "./lock-identity.js";
import type {
  LockLease,
  LockLiveness,
  LockManagerHooks,
  LockRecord,
} from "./types.js";

const LOCK_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

const ownershipLost = (id: string): never =>
  fail("LOCK_OWNERSHIP_LOST", 4, `Lock ownership lost: ${id}`);

export class LockManager {
  constructor(
    private paths: PathService,
    private hooks: LockManagerHooks = {},
  ) {}

  directory(id: string) {
    if (!LOCK_ID_PATTERN.test(id))
      fail("INVALID_LOCK_ID", 2, `Invalid lock ID: ${id}`);
    return resolveInside(this.paths.runtimeRoot(), id);
  }

  file(id: string) {
    return resolveInside(this.directory(id), "owner.json");
  }

  private updateGuard(id: string) {
    return resolveInside(this.directory(id), "update.lock");
  }

  private async withGuard<T>(id: string, action: () => Promise<T>): Promise<T> {
    const guard = this.updateGuard(id);
    let handle;
    for (let attempt = 0; ; attempt += 1) {
      try {
        handle = await fs.open(guard, "wx");
        break;
      } catch (error: unknown) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === "ENOENT") ownershipLost(id);
        if (code !== "EEXIST" || attempt >= 200) throw error;
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
    }
    try {
      return await action();
    } finally {
      await handle.close().catch(() => {});
      await fs.unlink(guard).catch(() => {});
    }
  }

  async acquire(
    id: string,
    command: string,
    runId?: string,
    identity: PhysicalResourceIdentity = {
      adapter: "unknown",
      kind: "resource",
      physicalId: id,
    },
    session?: string,
  ): Promise<LockRecord> {
    await fs.mkdir(this.paths.runtimeRoot(), { recursive: true });
    const directory = this.directory(id);
    try {
      await fs.mkdir(directory);
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        const holder = await readJson<LockRecord>(this.file(id));
        fail("DEVICE_BUSY", 4, `Resource ${id} is locked.`, { holder });
      }
      throw error;
    }
    const now = new Date();
    const record: LockRecord = {
      schema: "benchpilot.lock",
      version: 2,
      lockId: id,
      identity,
      ownerToken: randomBytes(16).toString("hex"),
      pid: process.pid,
      hostname: os.hostname(),
      session,
      command,
      runId,
      acquiredAt: now.toISOString(),
      heartbeatAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 30_000).toISOString(),
    };
    try {
      const owner = await fs.open(this.file(id), "wx");
      try {
        await owner.writeFile(JSON.stringify(record, null, 2));
      } finally {
        await owner.close();
      }
      return record;
    } catch (error) {
      await fs.rm(directory, { recursive: true }).catch(() => {});
      throw error;
    }
  }

  async heartbeat(lock: LockRecord, leaseMs = 30_000): Promise<LockRecord> {
    return this.withGuard(lock.lockId, async () => {
      const existing = await readJson<LockRecord>(this.file(lock.lockId));
      if (!existing)
        throw new BenchPilotError(
          "LOCK_OWNERSHIP_LOST",
          4,
          `Lock ownership lost: ${lock.lockId}`,
        );
      if (existing.ownerToken !== lock.ownerToken) ownershipLost(lock.lockId);
      await this.hooks.heartbeatRead?.(existing);
      const now = new Date();
      const updated: LockRecord = {
        ...existing,
        heartbeatAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + leaseMs).toISOString(),
      };
      await atomicJson(this.file(lock.lockId), updated);
      return updated;
    });
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
    void lost.catch(() => {});
    const loop = (async () => {
      while (!stopped) {
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, intervalMs);
          timer.unref();
          wake = () => {
            clearTimeout(timer);
            resolve();
          };
        });
        wake = undefined;
        if (stopped) break;
        try {
          await this.heartbeat(lock, leaseMs);
        } catch (error: unknown) {
          stopped = true;
          const failure =
            error instanceof BenchPilotError
              ? error
              : new BenchPilotError(
                  "LOCK_OWNERSHIP_LOST",
                  4,
                  "Lock heartbeat failed.",
                  false,
                  undefined,
                  [],
                  { cause: (error as Error).message },
                );
          this.hooks.guardError?.(failure);
          rejectLost(failure);
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
    try {
      process.kill(lock.pid, 0);
      return Number.isFinite(heartbeat) ? "active" : "unknown";
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH") return "stale";
      return severelyExpired ? "stale" : "unknown";
    }
  }

  async release(lock: LockRecord) {
    await this.withGuard(lock.lockId, async () => {
      const existing = await readJson<LockRecord>(this.file(lock.lockId));
      if (!existing) return;
      if (existing.ownerToken !== lock.ownerToken) ownershipLost(lock.lockId);
      await this.hooks.releaseRead?.(existing);
      await fs.unlink(this.file(lock.lockId));
    });
    try {
      await fs.rmdir(this.directory(lock.lockId));
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  async list(): Promise<LockRecord[]> {
    try {
      const entries = await fs.readdir(this.paths.runtimeRoot(), {
        withFileTypes: true,
      });
      const records = await Promise.all(
        entries
          .filter((entry) => entry.isDirectory())
          .map((entry) => readJson<LockRecord>(this.file(entry.name))),
      );
      return records.filter((record): record is LockRecord => Boolean(record));
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }

  async clear(id: string, dangerous: boolean) {
    let cleared!: LockRecord;
    await this.withGuard(id, async () => {
      const record = await readJson<LockRecord>(this.file(id));
      if (!record)
        throw new BenchPilotError("LOCK_NOT_FOUND", 3, `Lock not found: ${id}`);
      const status = await this.liveness(record);
      if (status !== "stale" && !dangerous)
        fail(
          "DANGEROUS_CONFIRMATION_REQUIRED",
          7,
          "Active lock requires --dangerously-clear-active-lock.",
        );
      await this.hooks.clearRead?.(record);
      const current = await readJson<LockRecord>(this.file(id));
      if (!current || current.ownerToken !== record.ownerToken)
        ownershipLost(id);
      await fs.unlink(this.file(id));
      cleared = record;
    });
    await fs.rmdir(this.directory(id));
    return cleared;
  }
}
