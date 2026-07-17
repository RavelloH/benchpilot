import { stdin, stdout } from "node:process";
import { fail, type Json } from "../../core.js";
import type { RuntimeUseCases } from "../../application/runtime/use-case.js";
import { brief } from "../help-renderer.js";
import type { Flags } from "../parser.js";
import { write } from "../output-renderer.js";
import { detectAgent } from "../agent/detector.js";
import { interactionDecision } from "../interaction/policy.js";

interface RuntimeCommandContext {
  parts: string[];
  flags: Flags;
  commandFlags: Json;
  runtime: RuntimeUseCases;
}

export async function handleRuntimeCommand({
  parts,
  flags,
  commandFlags,
  runtime,
}: RuntimeCommandContext): Promise<boolean> {
  if (parts[0] === "runs") {
    if (parts.length === 1) {
      stdout.write(brief("runs"));
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
      stdout.write(
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
      stdout.write(brief("locks"));
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
      stdout.write("benchpilot lock <lock-id> — Commands: show, clear\n");
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
    stdout.write(brief("approvals"));
    return true;
  }
  if (parts[0] === "approvals" && parts[1] === "list") {
    write(await runtime.listApprovals(), flags);
    return true;
  }
  if (parts[0] === "approval" && parts[1]) {
    if (parts.length === 2) {
      stdout.write(
        "benchpilot approval <approval-id> — Commands: inspect, approve, reject\n",
      );
      return true;
    }
    if (parts[2] === "inspect")
      write(await runtime.inspectApproval(parts[1]), flags);
    else if (parts[2] === "reject") {
      write(await runtime.rejectApproval(parts[1]), flags);
    } else if (parts[2] === "approve") {
      const decision = interactionDecision({
        agent: detectAgent(),
        json: flags.json,
        jsonl: flags.jsonl,
        stdinIsTTY: stdin.isTTY,
        stdoutIsTTY: stdout.isTTY,
        ci: Boolean(process.env.CI),
      });
      if (!decision.allowed)
        fail(
          decision.reason === "agent"
            ? "AGENT_INTERACTION_UNSUPPORTED"
            : "INTERACTIVE_APPROVAL_REQUIRED",
          7,
          decision.reason === "agent"
            ? "Approval requires a human interactive session and cannot be run by an agent."
            : "Approval requires an interactive TTY and cannot use machine output.",
        );
      const challenge = await runtime.approvalChallenge(parts[1]);
      stdout.write(
        `Risk approval ${parts[1]}. Type physical device ID (${challenge.physicalId}): `,
      );
      const answer = await new Promise<string>((r) =>
        stdin.once("data", (x) => r(String(x).trim())),
      );
      write(await runtime.approveApproval(parts[1], answer), flags);
    } else fail("USAGE_ERROR", 2, "Unknown approval command.");
    return true;
  }
  return false;
}
