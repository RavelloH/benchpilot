import { promises as fs } from "node:fs";
import path from "node:path";
import {
  duration,
  fail,
  type Json,
  type OperationLifecycleFactories,
  type PathService,
  type ResolvedConfig,
} from "../../core.js";

export interface RuntimeUseCaseDependencies {
  paths: PathService;
  project: Awaited<ReturnType<PathService["project"]>>;
  config: ResolvedConfig;
  lifecycle: OperationLifecycleFactories;
}

export interface PruneRunsInput {
  olderThan?: string;
  keep?: number;
  dangerouslyRemoveAllRuns?: boolean;
}

export interface ClearLockInput {
  dangerouslyClearActiveLock?: boolean;
  dangerouslyClearQuarantinedLock?: boolean;
}

/**
 * Administrative operations over persisted lifecycle state.  This module is
 * deliberately terminal-agnostic: callers supply validated values and render
 * the returned DTOs themselves.
 */
export class RuntimeUseCases {
  constructor(private readonly dependencies: RuntimeUseCaseDependencies) {}

  private projectRoot(): string {
    if (!this.dependencies.project)
      fail(
        "PROJECT_NOT_FOUND",
        3,
        "A BenchPilot project is required for project state commands.",
      );
    return this.dependencies.project!.root;
  }

  private runs() {
    return this.dependencies.lifecycle.runs(this.projectRoot());
  }

  private locks() {
    return this.dependencies.lifecycle.locks;
  }

  private approvals() {
    return this.dependencies.lifecycle.approvals(this.projectRoot());
  }

  async listRuns(input: { status?: Json; limit?: number } = {}) {
    let runs = await this.runs().list();
    if (input.status !== undefined)
      runs = runs.filter((run) => run.manifest?.status === input.status);
    if (input.limit !== undefined) {
      if (!Number.isInteger(input.limit) || input.limit < 0)
        fail(
          "USAGE_ERROR",
          2,
          "runs list --limit must be a non-negative integer.",
        );
      runs = runs.slice(0, input.limit);
    }
    return { runs };
  }

  async pruneRuns(input: PruneRunsInput) {
    if (
      !input.olderThan &&
      input.keep === undefined &&
      input.dangerouslyRemoveAllRuns !== true
    )
      fail(
        "DANGEROUS_CONFIRMATION_REQUIRED",
        7,
        "runs prune requires --older-than, --keep, or --dangerously-remove-all-runs.",
      );
    if (
      input.keep !== undefined &&
      (!Number.isInteger(input.keep) || input.keep < 0)
    )
      fail(
        "USAGE_ERROR",
        2,
        "runs prune --keep must be a non-negative integer.",
      );
    const runs = await this.runs().list();
    let remove = runs;
    if (input.keep !== undefined) remove = runs.slice(input.keep);
    if (input.olderThan) {
      const age = duration(input.olderThan);
      remove = runs.filter((run) => {
        const startedAt = Date.parse(String(run.manifest?.startedAt || ""));
        return Number.isFinite(startedAt) && Date.now() - startedAt > age;
      });
    }
    for (const run of remove)
      await fs.rm(
        path.join(this.dependencies.paths.runsRoot(this.projectRoot()), run.id),
        {
          recursive: true,
          force: true,
        },
      );
    return { removed: remove.map((run) => run.id) };
  }

  async showRun(id: string) {
    const record = await this.runs().get(id);
    return { manifest: record.manifest, result: record.result };
  }

  async runLog(id: string) {
    const record = await this.runs().get(id);
    return {
      log: await fs.readFile(path.join(record.dir, "benchpilot.log"), "utf8"),
    };
  }

  async runArtifacts(id: string) {
    const record = await this.runs().get(id);
    return {
      artifacts: await fs
        .readdir(path.join(record.dir, "artifacts"))
        .catch(() => []),
    };
  }

  async listLocks() {
    const listed = await this.locks().listWithCorrupt();
    return {
      locks: await Promise.all(
        listed.locks.map(async (lock) => ({
          ...lock,
          liveness: await this.locks().liveness(lock),
        })),
      ),
      corrupt: listed.corrupt,
    };
  }

  async clearStaleLocks() {
    return { cleared: await this.locks().clearStale() };
  }

  async inspectLock(id: string) {
    const lock = await this.locks().inspect(id);
    return { ...lock, liveness: await this.locks().liveness(lock) };
  }

  async clearLock(id: string, input: ClearLockInput) {
    return {
      cleared: await this.locks().clear(id, {
        dangerousActive: input.dangerouslyClearActiveLock,
        dangerousQuarantined: input.dangerouslyClearQuarantinedLock,
      }),
    };
  }

  async listApprovals() {
    return { approvals: await this.approvals().list() };
  }

  async inspectApproval(id: string) {
    return this.approvals().get(id);
  }

  async rejectApproval(id: string) {
    await this.approvals().change(id, "rejected");
    return { id, status: "rejected" as const };
  }

  async approvalChallenge(id: string) {
    const approval = await this.approvals().get(id);
    const physicalId = (
      approval.binding as { device?: { physicalId?: unknown } }
    ).device?.physicalId;
    if (typeof physicalId !== "string" || !physicalId)
      fail(
        "APPROVAL_CHALLENGE_UNAVAILABLE",
        7,
        "Approval does not contain a physical device challenge.",
      );
    return { id: approval.id, physicalId: physicalId as string };
  }

  async approveApproval(id: string, challenge: string) {
    const expected = await this.approvalChallenge(id);
    if (challenge !== expected.physicalId)
      fail("APPROVAL_CHALLENGE_FAILED", 7, "Challenge did not match.");
    await this.approvals().change(id, "approved");
    return { id, status: "approved" as const };
  }
}

export const createRuntimeUseCases = (
  dependencies: RuntimeUseCaseDependencies,
) => new RuntimeUseCases(dependencies);
