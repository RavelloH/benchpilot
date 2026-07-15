import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { BenchPilotError, fail } from "../errors/benchpilot-error.js";
import { PathService } from "../paths/path-service.js";
import { atomicJson, readJson } from "../utilities/atomic-json.js";
import { resolveInside } from "../utilities/resolve-inside.js";
import { sha } from "../utilities/stable-json.js";
import type {
  ApprovalLease,
  ApprovalLiveness,
  ApprovalRecord,
  Json,
} from "./types.js";

const APPROVAL_ID_PATTERN = /^approval-[a-f0-9]+$/;
const CLAIM_LEASE_MS = 300_000;
const CLAIM_HEARTBEAT_MS = 30_000;

const releasedClaim = (record: ApprovalRecord): ApprovalRecord => ({
  ...record,
  status: "approved",
  releasedAt: new Date().toISOString(),
  claimedBy: undefined,
  claimedAt: undefined,
  claimHeartbeatAt: undefined,
  claimExpiresAt: undefined,
  claimToken: undefined,
});

export class ApprovalManager {
  constructor(private paths: PathService) {}

  private assertId(id: string) {
    if (!APPROVAL_ID_PATTERN.test(id))
      fail("INVALID_APPROVAL_ID", 2, `Invalid approval ID: ${id}`);
  }

  private file(id: string) {
    this.assertId(id);
    return resolveInside(this.paths.approvalsRoot(), `${id}.json`);
  }

  private guard(id: string) {
    this.assertId(id);
    return resolveInside(this.paths.approvalsRoot(), `${id}.lock`);
  }

  private async withGuard<T>(id: string, action: () => Promise<T>): Promise<T> {
    await fs.mkdir(this.paths.approvalsRoot(), { recursive: true });
    const guard = this.guard(id);
    let handle;
    for (let attempt = 0; ; attempt += 1) {
      try {
        handle = await fs.open(guard, "wx");
        break;
      } catch (error: unknown) {
        if (
          !["EEXIST", "EPERM"].includes(
            (error as NodeJS.ErrnoException).code || "",
          ) ||
          attempt >= 200
        )
          throw error;
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

  async request(binding: Json, ttl = 3_600_000): Promise<ApprovalRecord> {
    await fs.mkdir(this.paths.approvalsRoot(), { recursive: true });
    const id = `approval-${randomBytes(5).toString("hex")}`;
    const record: ApprovalRecord = {
      schema: "benchpilot.approval",
      version: 1,
      id,
      digest: sha(binding),
      binding,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + ttl).toISOString(),
      status: "pending",
    };
    await atomicJson(this.file(id), record);
    return record;
  }

  async list(): Promise<ApprovalRecord[]> {
    try {
      const files = (await fs.readdir(this.paths.approvalsRoot())).filter(
        (file) => file.endsWith(".json"),
      );
      const records = await Promise.all(
        files.map((file) =>
          readJson<ApprovalRecord>(path.join(this.paths.approvalsRoot(), file)),
        ),
      );
      return records.filter((record): record is ApprovalRecord =>
        Boolean(record),
      );
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }

  async get(id: string): Promise<ApprovalRecord> {
    const record = await readJson<ApprovalRecord>(this.file(id));
    if (!record)
      throw new BenchPilotError(
        "APPROVAL_NOT_FOUND",
        3,
        `Approval not found: ${id}`,
      );
    return record;
  }

  async change(id: string, status: "approved" | "rejected") {
    await this.withGuard(id, async () => {
      const record = await this.get(id);
      if (record.status !== "pending")
        fail("APPROVAL_STATE_INVALID", 7, `Approval ${id} is not pending.`);
      if (Date.parse(record.expiresAt) <= Date.now())
        fail("APPROVAL_EXPIRED", 7, `Approval ${id} has expired.`);
      await atomicJson(this.file(id), {
        ...record,
        status,
        changedAt: new Date().toISOString(),
      });
    });
  }

  approvalLiveness(record: ApprovalRecord): ApprovalLiveness {
    if (record.status !== "claimed") return "unknown";
    const [hostname, pidText] = String(record.claimedBy || "").split(":");
    const expiresAt = Date.parse(record.claimExpiresAt || "");
    const severelyExpired =
      Number.isFinite(expiresAt) && Date.now() > expiresAt + 10_000;
    if (hostname === os.hostname() && /^\d+$/.test(pidText || "")) {
      try {
        process.kill(Number(pidText), 0);
        return "active";
      } catch (error: unknown) {
        return (error as NodeJS.ErrnoException).code === "ESRCH"
          ? "stale"
          : "unknown";
      }
    }
    return severelyExpired ? "stale" : "unknown";
  }

  async findMatchingApproval(
    binding: Json,
  ): Promise<ApprovalRecord | undefined> {
    const digest = sha(binding);
    return (await this.list()).find(
      (record) =>
        record.status === "approved" &&
        record.digest === digest &&
        Date.parse(record.expiresAt) > Date.now(),
    );
  }

  async recoverMatchingStaleClaim(
    binding: Json,
  ): Promise<ApprovalRecord | undefined> {
    const digest = sha(binding);
    for (const candidate of await this.list()) {
      if (candidate.digest !== digest || candidate.status !== "claimed")
        continue;
      const recovered = await this.withGuard(candidate.id, async () => {
        const current = await this.get(candidate.id);
        if (
          current.status !== "claimed" ||
          current.digest !== digest ||
          this.approvalLiveness(current) !== "stale" ||
          Date.parse(current.expiresAt) <= Date.now()
        )
          return undefined;
        const approval = releasedClaim(current);
        await atomicJson(this.file(current.id), approval);
        return approval;
      });
      if (recovered) return recovered;
    }
    return undefined;
  }

  async claim(binding: Json): Promise<ApprovalRecord | undefined> {
    const digest = sha(binding);
    await this.recoverMatchingStaleClaim(binding);
    for (const candidate of await this.list()) {
      if (candidate.digest !== digest || candidate.status !== "approved")
        continue;
      const claim = await this.withGuard(candidate.id, async () => {
        const current = await this.get(candidate.id);
        if (
          current.status !== "approved" ||
          current.digest !== digest ||
          Date.parse(current.expiresAt) <= Date.now()
        )
          return undefined;
        const now = new Date();
        const claimed: ApprovalRecord = {
          ...current,
          status: "claimed",
          claimedBy: `${os.hostname()}:${process.pid}`,
          claimedAt: now.toISOString(),
          claimHeartbeatAt: now.toISOString(),
          claimExpiresAt: new Date(
            now.getTime() + CLAIM_LEASE_MS,
          ).toISOString(),
          claimToken: randomBytes(16).toString("hex"),
        };
        await atomicJson(this.file(current.id), claimed);
        return claimed;
      });
      if (claim) return claim;
    }
    return undefined;
  }

  async renewClaim(
    record: ApprovalRecord,
    leaseMs = CLAIM_LEASE_MS,
  ): Promise<ApprovalRecord> {
    return this.withGuard(record.id, async () => {
      const current = await this.get(record.id);
      if (
        current.status !== "claimed" ||
        current.claimToken !== record.claimToken
      )
        fail(
          "APPROVAL_ALREADY_CLAIMED",
          7,
          `Approval ${record.id} is no longer claimed by this operation.`,
        );
      const now = new Date();
      const renewed: ApprovalRecord = {
        ...current,
        claimHeartbeatAt: now.toISOString(),
        claimExpiresAt: new Date(now.getTime() + leaseMs).toISOString(),
      };
      await atomicJson(this.file(record.id), renewed);
      return renewed;
    });
  }

  startClaimLease(
    approval: ApprovalRecord,
    intervalMs = CLAIM_HEARTBEAT_MS,
    leaseMs = CLAIM_LEASE_MS,
  ): ApprovalLease {
    let stopped = false;
    let wake: (() => void) | undefined;
    let resolveLost!: (error: BenchPilotError) => void;
    const lost = new Promise<BenchPilotError>((resolve) => {
      resolveLost = resolve;
    });
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
          await this.renewClaim(approval, leaseMs);
        } catch (error: unknown) {
          stopped = true;
          resolveLost(
            error instanceof BenchPilotError
              ? error
              : new BenchPilotError(
                  "APPROVAL_ALREADY_CLAIMED",
                  7,
                  "Approval lease renewal failed.",
                ),
          );
        }
      }
    })();
    return {
      approval,
      lost,
      async stop() {
        stopped = true;
        wake?.();
        await loop;
      },
    };
  }

  async consumeClaim(record: ApprovalRecord) {
    await this.withGuard(record.id, async () => {
      const current = await this.get(record.id);
      if (
        current.status !== "claimed" ||
        current.claimToken !== record.claimToken
      )
        fail(
          "APPROVAL_ALREADY_CLAIMED",
          7,
          `Approval ${record.id} is no longer claimed by this operation.`,
        );
      await atomicJson(this.file(record.id), {
        ...current,
        status: "consumed",
        consumedAt: new Date().toISOString(),
      });
    });
  }

  async releaseClaim(record: ApprovalRecord) {
    await this.withGuard(record.id, async () => {
      const current = await this.get(record.id);
      if (
        current.status !== "claimed" ||
        current.claimToken !== record.claimToken
      )
        fail(
          "APPROVAL_ALREADY_CLAIMED",
          7,
          `Approval ${record.id} is no longer claimed by this operation.`,
        );
      await atomicJson(this.file(record.id), releasedClaim(current));
    });
  }

  async consume(binding: Json) {
    const claim = await this.claim(binding);
    if (!claim) return false;
    await this.consumeClaim(claim);
    return true;
  }
}
