import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { BenchPilotError } from "../errors/benchpilot-error.js";
import { readJson } from "../utilities/atomic-json.js";

export interface GuardRecord {
  schema: "benchpilot.guard";
  version: 1;
  token: string;
  pid: number;
  hostname: string;
  createdAt: string;
  expiresAt: string;
  resourceType: "lock-update" | "approval-update";
  resourceId: string;
}

export type GuardLiveness = "active" | "stale" | "unknown";

export interface FileGuard {
  readonly record: GuardRecord;
  release(): Promise<void>;
}

export interface FileGuardOptions {
  resourceType: GuardRecord["resourceType"];
  resourceId: string;
  leaseMs?: number;
  timeoutMs?: number;
  busyKind?: string;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A competing holder may have created its exclusive file but not finished its
 * first write yet. Treat that brief initialization window as busy. */
async function readGuard(file: string): Promise<GuardRecord | undefined> {
  try {
    return await readJson<GuardRecord>(file);
  } catch (error) {
    if (error instanceof SyntaxError) return undefined;
    throw error;
  }
}

export function guardLiveness(
  record: GuardRecord,
  now = Date.now(),
): GuardLiveness {
  const expiresAt = Date.parse(record.expiresAt);
  const severelyExpired =
    Number.isFinite(expiresAt) && now > expiresAt + 10_000;
  if (record.hostname !== os.hostname())
    return severelyExpired ? "stale" : "unknown";
  try {
    process.kill(record.pid, 0);
    return "active";
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return "stale";
    return severelyExpired ? "stale" : "unknown";
  }
}

async function writeExclusive(file: string, record: GuardRecord) {
  const handle = await fs.open(file, "wx");
  try {
    await handle.writeFile(JSON.stringify(record));
  } finally {
    await handle.close();
  }
}

async function recoverStaleGuard(file: string, expected: GuardRecord) {
  const recovery = `${file}.recovery`;
  const record: GuardRecord = {
    schema: "benchpilot.guard",
    version: 1,
    token: randomBytes(16).toString("hex"),
    pid: process.pid,
    hostname: os.hostname(),
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 10_000).toISOString(),
    resourceType: expected.resourceType,
    resourceId: expected.resourceId,
  };
  try {
    await writeExclusive(recovery, record);
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw error;
  }
  try {
    const current = await readGuard(file);
    if (current?.token === expected.token && guardLiveness(current) === "stale")
      await fs.unlink(file);
    return true;
  } finally {
    const currentRecovery = await readGuard(recovery);
    if (currentRecovery?.token === record.token) await fs.unlink(recovery);
  }
}

export async function acquireFileGuard(
  file: string,
  options: FileGuardOptions,
): Promise<FileGuard> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const started = Date.now();
  const timeoutMs = options.timeoutMs ?? 10_000;
  const leaseMs = options.leaseMs ?? 10_000;
  for (;;) {
    const now = new Date();
    const record: GuardRecord = {
      schema: "benchpilot.guard",
      version: 1,
      token: randomBytes(16).toString("hex"),
      pid: process.pid,
      hostname: os.hostname(),
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + leaseMs).toISOString(),
      resourceType: options.resourceType,
      resourceId: options.resourceId,
    };
    try {
      await writeExclusive(file, record);
      return {
        record,
        async release() {
          const current = await readGuard(file);
          if (current?.token === record.token) await fs.unlink(file);
        },
      };
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const current = await readGuard(file);
      if (current && guardLiveness(current) === "stale") {
        await recoverStaleGuard(file, current);
        continue;
      }
      if (Date.now() - started >= timeoutMs)
        throw new BenchPilotError(
          options.busyKind ?? "FILE_GUARD_BUSY",
          4,
          `Update guard is busy for ${options.resourceType}:${options.resourceId}.`,
          true,
          undefined,
          [],
          { guard: current },
        );
      await sleep(5);
    }
  }
}

export async function withFileGuard<T>(
  file: string,
  options: FileGuardOptions,
  action: () => Promise<T>,
): Promise<T> {
  const guard = await acquireFileGuard(file, options);
  try {
    return await action();
  } finally {
    await guard.release();
  }
}
