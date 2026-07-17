import { fail, type Json } from "../../core.js";
import type { RuntimeUseCases } from "../../application/runtime/use-case.js";
import { brief, fullHelp } from "../help-renderer.js";
import type { Flags } from "../parser.js";
import { write } from "../output-renderer.js";

interface RuntimeCommandContext {
  parts: string[];
  flags: Flags;
  commandFlags: Json;
  runtime: RuntimeUseCases;
  readApprovalChallenge: (input: {
    approvalId: string;
    physicalId: string;
  }) => Promise<string>;
}

export async function handleRuntimeCommand({
  parts,
  flags,
  commandFlags,
  runtime,
  readApprovalChallenge,
}: RuntimeCommandContext): Promise<boolean> {
  if (parts[0] === "runs") {
    if (parts.length === 1) {
      write(fullHelp(["runs"]), flags, brief("runs"));
      return true;
    }
    if (parts[1] === "list") {
      write(
        await runtime.listRuns({
          status: commandFlags.status as Json | undefined,
          limit:
            commandFlags.limit === undefined
              ? undefined
              : Number(commandFlags.limit),
        }),
        flags,
      );
      return true;
    }
    if (parts[1] === "prune") {
      write(
        await runtime.pruneRuns({
          olderThan:
            commandFlags["older-than"] === undefined
              ? undefined
              : String(commandFlags["older-than"]),
          keep:
            commandFlags.keep === undefined
              ? undefined
              : Number(commandFlags.keep),
          dangerouslyRemoveAllRuns:
            commandFlags["dangerously-remove-all-runs"] === true,
        }),
        flags,
      );
      return true;
    }
  }
  if (parts[0] === "run" && parts[1]) {
    if (parts.length === 2) {
      write(
        fullHelp(["run"]),
        flags,
        "benchpilot run <run-id> — Commands: show, logs, artifacts\n",
      );
      return true;
    }
    if (parts[2] === "show") write(await runtime.showRun(parts[1]), flags);
    else if (parts[2] === "logs") {
      const result = await runtime.runLog(parts[1]);
      write(result, flags, result.log);
    } else if (parts[2] === "artifacts")
      write(await runtime.runArtifacts(parts[1]), flags);
    else fail("USAGE_ERROR", 2, "Unknown run command.");
    return true;
  }
  if (parts[0] === "locks") {
    if (parts.length === 1) {
      write(fullHelp(["locks"]), flags, brief("locks"));
      return true;
    }
    if (parts[1] === "list") write(await runtime.listLocks(), flags);
    else if (parts[1] === "clear-stale") {
      write(await runtime.clearStaleLocks(), flags);
      return true;
    }
    return true;
  }
  if (parts[0] === "lock" && parts[1]) {
    if (parts.length === 2) {
      write(
        fullHelp(["lock"]),
        flags,
        "benchpilot lock <lock-id> — Commands: show, clear\n",
      );
      return true;
    }
    if (parts[2] === "show" || parts[2] === "inspect")
      write(await runtime.inspectLock(parts[1]), flags);
    else if (parts[2] === "clear")
      write(
        await runtime.clearLock(parts[1], {
          dangerouslyClearActiveLock: Boolean(
            commandFlags["dangerously-clear-active-lock"],
          ),
          dangerouslyClearQuarantinedLock: Boolean(
            commandFlags["dangerously-clear-quarantined-lock"],
          ),
        }),
        flags,
      );
    else fail("USAGE_ERROR", 2, "Unknown lock command.");
    return true;
  }
  if (parts[0] === "approvals" && parts.length === 1) {
    write(fullHelp(["approvals"]), flags, brief("approvals"));
    return true;
  }
  if (parts[0] === "approvals" && parts[1] === "list") {
    write(await runtime.listApprovals(), flags);
    return true;
  }
  if (parts[0] === "approval" && parts[1]) {
    if (parts.length === 2) {
      write(
        fullHelp(["approval"]),
        flags,
        "benchpilot approval <approval-id> — Commands: inspect, approve, reject\n",
      );
      return true;
    }
    if (parts[2] === "inspect")
      write(await runtime.inspectApproval(parts[1]), flags);
    else if (parts[2] === "reject") {
      write(await runtime.rejectApproval(parts[1]), flags);
    } else if (parts[2] === "approve") {
      const challenge = await runtime.approvalChallenge(parts[1]);
      const answer = await readApprovalChallenge({
        approvalId: challenge.id,
        physicalId: challenge.physicalId,
      });
      write(await runtime.approveApproval(parts[1], answer), flags);
    } else fail("USAGE_ERROR", 2, "Unknown approval command.");
    return true;
  }
  return false;
}
