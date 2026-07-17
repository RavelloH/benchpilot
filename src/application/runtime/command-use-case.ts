import { fail, type Json } from "../../core.js";
import type { RuntimeUseCases } from "./use-case.js";

export type RuntimeCommandAction =
  | "runs.list"
  | "runs.prune"
  | "run.show"
  | "run.logs"
  | "run.artifacts"
  | "locks.list"
  | "locks.clear-stale"
  | "lock.show"
  | "lock.clear"
  | "approvals.list"
  | "approval.inspect"
  | "approval.reject"
  | "approval.challenge"
  | "approval.approve";

export interface RuntimeCommandRequest {
  action: string;
  id?: string;
  status?: Json;
  limit?: Json;
  olderThan?: Json;
  keep?: Json;
  dangerouslyRemoveAllRuns?: boolean;
  dangerouslyClearActiveLock?: boolean;
  dangerouslyClearQuarantinedLock?: boolean;
  challenge?: string;
}

export interface RuntimeCommandOutcome {
  kind: `runtime.${RuntimeCommandAction}`;
  data: Json;
}

const number = (value: Json | undefined) =>
  value === undefined ? undefined : Number(value);

/** Terminal-independent administrative command dispatch. */
export class RuntimeCommandUseCases {
  constructor(private readonly runtime: RuntimeUseCases) {}

  async execute(
    request: RuntimeCommandRequest,
  ): Promise<RuntimeCommandOutcome> {
    const action = request.action as RuntimeCommandAction;
    const needsId = [
      "run.show",
      "run.logs",
      "run.artifacts",
      "lock.show",
      "lock.clear",
      "approval.inspect",
      "approval.reject",
      "approval.challenge",
      "approval.approve",
    ].includes(action);
    if (!runtimeActions.has(action))
      fail("USAGE_ERROR", 2, `Unknown runtime command: ${request.action}`);
    if (needsId && !request.id)
      fail("USAGE_ERROR", 2, `${action} requires an identifier.`);
    switch (action) {
      case "runs.list":
        return this.outcome(
          action,
          await this.runtime.listRuns({
            status: request.status,
            limit: number(request.limit),
          }),
        );
      case "runs.prune":
        return this.outcome(
          action,
          await this.runtime.pruneRuns({
            olderThan:
              request.olderThan === undefined
                ? undefined
                : String(request.olderThan),
            keep: number(request.keep),
            dangerouslyRemoveAllRuns: request.dangerouslyRemoveAllRuns,
          }),
        );
      case "run.show":
        return this.outcome(action, await this.runtime.showRun(request.id!));
      case "run.logs":
        return this.outcome(action, await this.runtime.runLog(request.id!));
      case "run.artifacts":
        return this.outcome(
          action,
          await this.runtime.runArtifacts(request.id!),
        );
      case "locks.list":
        return this.outcome(action, await this.runtime.listLocks());
      case "locks.clear-stale":
        return this.outcome(action, await this.runtime.clearStaleLocks());
      case "lock.show":
        return this.outcome(
          action,
          (await this.runtime.inspectLock(request.id!)) as Json,
        );
      case "lock.clear":
        return this.outcome(
          action,
          await this.runtime.clearLock(request.id!, {
            dangerouslyClearActiveLock: request.dangerouslyClearActiveLock,
            dangerouslyClearQuarantinedLock:
              request.dangerouslyClearQuarantinedLock,
          }),
        );
      case "approvals.list":
        return this.outcome(action, await this.runtime.listApprovals());
      case "approval.inspect":
        return this.outcome(
          action,
          (await this.runtime.inspectApproval(request.id!)) as unknown as Json,
        );
      case "approval.reject":
        return this.outcome(
          action,
          await this.runtime.rejectApproval(request.id!),
        );
      case "approval.challenge":
        return this.outcome(
          action,
          await this.runtime.approvalChallenge(request.id!),
        );
      case "approval.approve":
        const challenge = request.challenge;
        if (challenge === undefined)
          fail("USAGE_ERROR", 2, "approval.approve requires a challenge.");
        return this.outcome(
          action,
          await this.runtime.approveApproval(request.id!, challenge!),
        );
    }
  }

  private outcome(
    action: RuntimeCommandAction,
    data: Json,
  ): RuntimeCommandOutcome {
    return { kind: `runtime.${action}`, data };
  }
}

const runtimeActions = new Set<RuntimeCommandAction>([
  "runs.list",
  "runs.prune",
  "run.show",
  "run.logs",
  "run.artifacts",
  "locks.list",
  "locks.clear-stale",
  "lock.show",
  "lock.clear",
  "approvals.list",
  "approval.inspect",
  "approval.reject",
  "approval.challenge",
  "approval.approve",
]);

export const createRuntimeCommandUseCases = (runtime: RuntimeUseCases) =>
  new RuntimeCommandUseCases(runtime);
