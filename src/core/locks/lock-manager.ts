import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { BenchPilotError, fail } from "../errors/benchpilot-error.js";
import { withFileGuard } from "../concurrency/file-guard.js";
import { PathService } from "../paths/path-service.js";
import { atomicJson, readJson } from "../utilities/atomic-json.js";
import { resolveInside } from "../utilities/resolve-inside.js";
import type { PhysicalResourceIdentity } from "./lock-identity.js";
import type {
  LockLease,
  LockLiveness,
  LockManagerHooks,
  LockQuarantineReason,
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

  private guard(id: string) {
    return resolveInside(this.paths.lockGuardsRoot(), `${id}.lock`);
  }

  private async withGuard<T>(id: string, action: () => Promise<T>): Promise<T> {
    return withFileGuard(
      this.guard(id),
      {
        resourceType: "lock-update",
        resourceId: id,
        busyKind: "LOCK_GUARD_BUSY",
      },
      action,
    );
  }

  private async clearEmptyDirectory(id: string) {
    try {
      const entries = await fs.readdir(this.directory(id));
      if (entries.length === 0) {
        await fs.rmdir(this.directory(id));
        return true;
      }
      return false;
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return true;
      throw error;
    }
  }

  private async corrupt(id: string): Promise<never> {
    const directory = this.directory(id);
    const entries = await fs.readdir(directory).catch(() => []);
    return fail("LOCK_CORRUPT", 4, `Lock directory is corrupt: ${id}`, {
      directory,
      entries,
      recovery: [
        "Inspect the lock directory and confirm no hardware operation is active.",
        "Remove unknown contents only after explicit operator review.",
      ],
    });
  }

  private isRecord(value: unknown): value is LockRecord {
    if (!value || typeof value !== "object") return false;
    const record = value as Partial<LockRecord>;
    return (
      record.schema === "benchpilot.lock" &&
      record.version === 2 &&
      (record.state === "active" || record.state === "quarantined") &&
      typeof record.lockId === "string" &&
      typeof record.ownerToken === "string" &&
      typeof record.pid === "number" &&
      typeof record.hostname === "string"
    );
  }

  private async recoverCreatingDirectories(id: string) {
    const prefix = `${id}.creating-`;
    const entries = await fs
      .readdir(this.paths.runtimeRoot(), { withFileTypes: true })
      .catch((error: NodeJS.ErrnoException) =>
        error.code === "ENOENT" ? [] : Promise.reject(error),
      );
    for (const entry of entries)
      if (entry.isDirectory() && entry.name.startsWith(prefix)) {
        const directory = resolveInside(this.paths.runtimeRoot(), entry.name);
        const creating = await readJson<LockRecord>(
          path.join(directory, "creating.json"),
        );
        if (creating && (await this.liveness(creating)) === "stale")
          await fs.rm(directory, { recursive: true, force: true });
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
    attempts = 0,
  ): Promise<LockRecord> {
    await fs.mkdir(this.paths.runtimeRoot(), { recursive: true });
    await this.recoverCreatingDirectories(id);
    const now = new Date();
    const record: LockRecord = {
      schema: "benchpilot.lock",
      version: 2,
      state: "active",
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
    const directory = this.directory(id);
    const staging = `${directory}.creating-${record.ownerToken}`;
    try {
      await fs.mkdir(staging);
      await atomicJson(path.join(staging, "creating.json"), record);
      await atomicJson(path.join(staging, "owner.json"), record);
      await fs.rename(staging, directory);
      return record;
    } catch (error: unknown) {
      await fs.rm(staging, { recursive: true, force: true }).catch(() => {});
      if (
        !["EEXIST", "EPERM", "ENOTEMPTY"].includes(
          (error as NodeJS.ErrnoException).code || "",
        )
      )
        throw error;
      let holder: LockRecord | undefined;
      try {
        holder = await readJson<LockRecord>(this.file(id));
      } catch {
        return this.corrupt(id);
      }
      if (!holder) {
        if (attempts >= 1 || !(await this.clearEmptyDirectory(id)))
          return this.corrupt(id);
        return this.acquire(
          id,
          command,
          runId,
          identity,
          session,
          attempts + 1,
        );
      }
      if (!this.isRecord(holder)) return this.corrupt(id);
      if (holder.state === "quarantined")
        fail("DEVICE_QUARANTINED", 4, `Resource ${id} is quarantined.`, {
          lockId: id,
          quarantineReason: holder.quarantineReason,
          recovery: [
            "Confirm that the previous tool process and hardware connection are no longer active.",
            "Clear the quarantined lock explicitly.",
          ],
        });
      return fail("DEVICE_BUSY", 4, `Resource ${id} is locked.`, { holder });
    }
  }

  async heartbeat(lock: LockRecord, leaseMs = 30_000): Promise<LockRecord> {
    return this.withGuard(lock.lockId, async () => {
      const existing = await readJson<LockRecord>(this.file(lock.lockId));
      if (!existing || existing.state !== "active")
        return ownershipLost(lock.lockId);
      if (existing.ownerToken !== lock.ownerToken) ownershipLost(lock.lockId);
      await this.hooks.heartbeatRead?.(existing);
      const current = await readJson<LockRecord>(this.file(lock.lockId));
      if (!current || current.state !== "active")
        return ownershipLost(lock.lockId);
      if (current.ownerToken !== lock.ownerToken) ownershipLost(lock.lockId);
      const now = new Date();
      const updated: LockRecord = {
        ...current,
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

  async quarantine(
    lock: LockRecord,
    reason: Omit<LockQuarantineReason, "quarantinedAt">,
  ) {
    return this.withGuard(lock.lockId, async () => {
      const current = await readJson<LockRecord>(this.file(lock.lockId));
      if (!current || current.ownerToken !== lock.ownerToken)
        return ownershipLost(lock.lockId);
      const quarantined: LockRecord = {
        ...current,
        state: "quarantined",
        quarantineReason: {
          ...reason,
          quarantinedAt: new Date().toISOString(),
        },
      };
      await atomicJson(this.file(lock.lockId), quarantined);
      return quarantined;
    });
  }

  async release(lock: LockRecord) {
    let tombstone: string | undefined;
    await this.withGuard(lock.lockId, async () => {
      const existing = await readJson<LockRecord>(this.file(lock.lockId));
      if (!existing) return;
      if (existing.ownerToken !== lock.ownerToken) ownershipLost(lock.lockId);
      if (existing.state === "quarantined")
        fail("LOCK_QUARANTINED", 4, `Lock is quarantined: ${lock.lockId}`);
      await this.hooks.releaseRead?.(existing);
      const current = await readJson<LockRecord>(this.file(lock.lockId));
      if (!current || current.ownerToken !== lock.ownerToken)
        ownershipLost(lock.lockId);
      tombstone = `${this.directory(lock.lockId)}.released-${randomBytes(8).toString("hex")}`;
      await fs.rename(this.directory(lock.lockId), tombstone);
    });
    if (tombstone) await fs.rm(tombstone, { recursive: true, force: true });
  }

  async list(): Promise<LockRecord[]> {
    try {
      const entries = await fs.readdir(this.paths.runtimeRoot(), {
        withFileTypes: true,
      });
      const records = await Promise.all(
        entries
          .filter(
            (entry) =>
              entry.isDirectory() &&
              LOCK_ID_PATTERN.test(entry.name) &&
              !entry.name.includes(".creating-") &&
              !entry.name.includes(".released-"),
          )
          .map((entry) => readJson<LockRecord>(this.file(entry.name))),
      );
      return records.filter((record): record is LockRecord => Boolean(record));
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }

  async clear(
    id: string,
    options:
      | boolean
      | { dangerousActive?: boolean; dangerousQuarantined?: boolean } = false,
  ) {
    const dangerousActive =
      typeof options === "boolean" ? options : Boolean(options.dangerousActive);
    const dangerousQuarantined =
      typeof options === "boolean"
        ? options
        : Boolean(options.dangerousQuarantined);
    let cleared!: LockRecord;
    let tombstone: string | undefined;
    await this.withGuard(id, async () => {
      const record = await readJson<LockRecord>(this.file(id));
      if (!record)
        throw new BenchPilotError("LOCK_NOT_FOUND", 3, `Lock not found: ${id}`);
      if (record.state === "quarantined" && !dangerousQuarantined)
        fail(
          "DANGEROUS_CONFIRMATION_REQUIRED",
          7,
          "Quarantined lock requires --dangerously-clear-quarantined-lock.",
        );
      const status = await this.liveness(record);
      if (
        record.state !== "quarantined" &&
        status !== "stale" &&
        !dangerousActive
      )
        fail(
          "DANGEROUS_CONFIRMATION_REQUIRED",
          7,
          "Active lock requires --dangerously-clear-active-lock.",
        );
      await this.hooks.clearRead?.(record);
      const current = await readJson<LockRecord>(this.file(id));
      if (!current || current.ownerToken !== record.ownerToken)
        ownershipLost(id);
      tombstone = `${this.directory(id)}.released-${randomBytes(8).toString("hex")}`;
      await fs.rename(this.directory(id), tombstone);
      cleared = record;
    });
    if (tombstone) await fs.rm(tombstone, { recursive: true, force: true });
    return cleared;
  }
}
