import { fail, type Json } from "../../core.js";
import type { RuntimeCommandUseCases } from "../../application/runtime/command-use-case.js";
import { brief, fullHelp } from "../help-renderer.js";
import type { Flags } from "../parser.js";
import { write } from "../output-renderer.js";

interface RuntimeCommandContext {
  parts: string[];
  flags: Flags;
  commandFlags: Json;
  runtimeCommands: RuntimeCommandUseCases;
  readApprovalChallenge: (input: {
    approvalId: string;
    physicalId: string;
  }) => Promise<string>;
}

export async function handleRuntimeCommand({
  parts,
  flags,
  commandFlags,
  runtimeCommands,
  readApprovalChallenge,
}: RuntimeCommandContext): Promise<boolean> {
  if (parts[0] === "runs") {
    if (parts.length === 1) {
      write(fullHelp(["runs"]), flags, brief("runs"));
      return true;
    }
    if (parts[1] === "list") {
      write(
        (
          await runtimeCommands.execute({
            action: "runs.list",
            status: commandFlags.status as Json | undefined,
            limit: commandFlags.limit as Json | undefined,
          })
        ).data,
        flags,
      );
      return true;
    }
    if (parts[1] === "prune") {
      write(
        (
          await runtimeCommands.execute({
            action: "runs.prune",
            olderThan: commandFlags["older-than"] as Json | undefined,
            keep: commandFlags.keep as Json | undefined,
            dangerouslyRemoveAllRuns:
              commandFlags["dangerously-remove-all-runs"] === true,
          })
        ).data,
        flags,
      );
      return true;
    }
    fail("USAGE_ERROR", 2, "Unknown runs command.");
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
    if (parts[2] === "show")
      write(
        (await runtimeCommands.execute({ action: "run.show", id: parts[1] }))
          .data,
        flags,
      );
    else if (parts[2] === "logs") {
      const result = (
        await runtimeCommands.execute({ action: "run.logs", id: parts[1] })
      ).data as { log: string };
      write(result, flags, result.log);
    } else if (parts[2] === "artifacts")
      write(
        (
          await runtimeCommands.execute({
            action: "run.artifacts",
            id: parts[1],
          })
        ).data,
        flags,
      );
    else fail("USAGE_ERROR", 2, "Unknown run command.");
    return true;
  }
  if (parts[0] === "locks") {
    if (parts.length === 1) {
      write(fullHelp(["locks"]), flags, brief("locks"));
      return true;
    }
    if (parts[1] === "list") {
      write(
        (await runtimeCommands.execute({ action: "locks.list" })).data,
        flags,
      );
      return true;
    }
    if (parts[1] === "clear-stale") {
      write(
        (await runtimeCommands.execute({ action: "locks.clear-stale" })).data,
        flags,
      );
      return true;
    }
    fail("USAGE_ERROR", 2, "Unknown locks command.");
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
      write(
        (await runtimeCommands.execute({ action: "lock.show", id: parts[1] }))
          .data,
        flags,
      );
    else if (parts[2] === "clear")
      write(
        (
          await runtimeCommands.execute({
            action: "lock.clear",
            id: parts[1],
            dangerouslyClearActiveLock: Boolean(
              commandFlags["dangerously-clear-active-lock"],
            ),
            dangerouslyClearQuarantinedLock: Boolean(
              commandFlags["dangerously-clear-quarantined-lock"],
            ),
          })
        ).data,
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
    write(
      (await runtimeCommands.execute({ action: "approvals.list" })).data,
      flags,
    );
    return true;
  }
  if (parts[0] === "approvals")
    fail("USAGE_ERROR", 2, "Unknown approvals command.");
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
      write(
        (
          await runtimeCommands.execute({
            action: "approval.inspect",
            id: parts[1],
          })
        ).data,
        flags,
      );
    else if (parts[2] === "reject") {
      write(
        (
          await runtimeCommands.execute({
            action: "approval.reject",
            id: parts[1],
          })
        ).data,
        flags,
      );
    } else if (parts[2] === "approve") {
      const challenge = (
        await runtimeCommands.execute({
          action: "approval.challenge",
          id: parts[1],
        })
      ).data as { id: string; physicalId: string };
      const answer = await readApprovalChallenge({
        approvalId: challenge.id,
        physicalId: challenge.physicalId,
      });
      write(
        (
          await runtimeCommands.execute({
            action: "approval.approve",
            id: parts[1],
            challenge: answer,
          })
        ).data,
        flags,
      );
    } else fail("USAGE_ERROR", 2, "Unknown approval command.");
    return true;
  }
  return false;
}
