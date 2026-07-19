import {
  fail,
  type Json,
  type LockLiveness,
  type LockRecord,
} from "../../core.js";
import type { RuntimeCommandUseCases } from "../../application/runtime/command-use-case.js";
import type { Locale } from "../../i18n/index.js";
import {
  approvalChangeDataPage,
  approvalDetailDataPage,
  approvalListDataPage,
} from "../data/approval.js";
import {
  lockClearDataPage,
  lockClearStaleDataPage,
  lockDetailDataPage,
  lockListDataPage,
} from "../data/lock.js";
import { brief, fullHelp } from "../help-renderer.js";
import type { Flags } from "../parser.js";
import { write, writeDataPage } from "../output-renderer.js";
import type { PresentationView } from "../presentation/page.js";

interface RuntimeCommandContext {
  parts: string[];
  flags: Flags;
  commandFlags: Json;
  locale: Locale;
  color: boolean;
  presentationView: PresentationView;
  runtimeCommands: RuntimeCommandUseCases;
  approvalPresentation?: {
    projectId?: string;
    projectName?: string;
  };
  confirmApproval: (input: {
    approvalId: string;
    action: "approve" | "reject";
  }) => Promise<boolean>;
}

export async function handleRuntimeCommand({
  parts,
  flags,
  commandFlags,
  locale,
  color,
  presentationView,
  runtimeCommands,
  approvalPresentation,
  confirmApproval,
}: RuntimeCommandContext): Promise<boolean> {
  if (parts[0] === "run" && parts[1] === "list") {
    if (parts.length !== 2)
      fail("USAGE_ERROR", 2, "run list takes no arguments.");
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
  if (parts[0] === "run" && parts[1] === "prune") {
    if (parts.length !== 2)
      fail("USAGE_ERROR", 2, "run prune takes no arguments.");
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
  if (parts[0] === "run") {
    if (parts.length === 1) {
      write(fullHelp(["run"]), flags, brief("run"));
      return true;
    }
    if (!parts[1]) fail("USAGE_ERROR", 2, "run requires an identifier.");
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
  if (parts[0] === "lock" && parts[1] === "list") {
    if (parts.length !== 2)
      fail("USAGE_ERROR", 2, "lock list takes no arguments.");
    const result = (
      await runtimeCommands.execute({
        action: "locks.list",
      })
    ).data as unknown as {
      locks: (LockRecord & { liveness: LockLiveness })[];
      corrupt: { lockId: string; directory: string; entries: string[] }[];
    };
    writeDataPage({
      page: lockListDataPage(result),
      flags,
      locale,
      view: presentationView,
      color,
    });
    return true;
  }
  if (parts[0] === "lock" && parts[1] === "clear-stale") {
    if (parts.length !== 2)
      fail("USAGE_ERROR", 2, "lock clear-stale takes no arguments.");
    const result = (
      await runtimeCommands.execute({
        action: "locks.clear-stale",
      })
    ).data as { cleared: string[] };
    writeDataPage({
      page: lockClearStaleDataPage(result.cleared),
      flags,
      locale,
      view: presentationView,
      color,
    });
    return true;
  }
  if (parts[0] === "lock") {
    if (parts.length === 1) {
      write(fullHelp(["lock"]), flags, brief("lock"));
      return true;
    }
    if (!parts[1]) fail("USAGE_ERROR", 2, "lock requires an identifier.");
    if (parts.length === 2) {
      write(
        fullHelp(["lock"]),
        flags,
        "benchpilot lock <lock-id> — Commands: show, clear\n",
      );
      return true;
    }
    if (parts[2] === "show" || parts[2] === "inspect") {
      const record = (
        await runtimeCommands.execute({
          action: "lock.show",
          id: parts[1],
        })
      ).data as unknown as LockRecord & { liveness: LockLiveness };
      writeDataPage({
        page: lockDetailDataPage(record),
        flags,
        locale,
        view: presentationView,
        color,
      });
    } else if (parts[2] === "clear") {
      const result = (
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
      ).data as unknown as { cleared: LockRecord };
      writeDataPage({
        page: lockClearDataPage(result.cleared),
        flags,
        locale,
        view: presentationView,
        color,
      });
    } else fail("USAGE_ERROR", 2, "Unknown lock command.");
    return true;
  }
  if (parts[0] === "approval" && parts[1] === "list") {
    if (parts.length !== 2)
      fail("USAGE_ERROR", 2, "approval list takes no arguments.");
    const approvals = (
      await runtimeCommands.execute({ action: "approvals.list" })
    ).data as unknown as {
      approvals: import("../../core.js").ApprovalRecord[];
    };
    writeDataPage({
      page: approvalListDataPage(approvals.approvals),
      flags,
      locale,
      view: presentationView,
      color,
    });
    return true;
  }
  if (parts[0] === "approval") {
    if (parts.length === 1) {
      write(fullHelp(["approval"]), flags, brief("approval"));
      return true;
    }
    if (!parts[1]) fail("USAGE_ERROR", 2, "approval requires an identifier.");
    if (parts.length === 2) {
      write(
        fullHelp(["approval"]),
        flags,
        "benchpilot approval <approval-id> — Commands: inspect, approve, reject\n",
      );
      return true;
    }
    const approval = (
      await runtimeCommands.execute({
        action: "approval.inspect",
        id: parts[1],
      })
    ).data as unknown as import("../../core.js").ApprovalRecord;
    const inspect = () =>
      writeDataPage({
        page: approvalDetailDataPage(approval, approvalPresentation),
        flags,
        locale,
        view: presentationView,
        color,
      });
    if (parts[2] === "inspect") inspect();
    else if (parts[2] === "reject") {
      inspect();
      if (!(await confirmApproval({ approvalId: parts[1], action: "reject" })))
        return true;
      const result = (
        await runtimeCommands.execute({
          action: "approval.reject",
          id: parts[1],
        })
      ).data as { id: string; status: "rejected" };
      writeDataPage({
        page: approvalChangeDataPage(result),
        flags,
        locale,
        view: presentationView,
        color,
      });
    } else if (parts[2] === "approve") {
      inspect();
      if (!(await confirmApproval({ approvalId: parts[1], action: "approve" })))
        return true;
      const result = (
        await runtimeCommands.execute({
          action: "approval.approve",
          id: parts[1],
        })
      ).data as { id: string; status: "approved" };
      writeDataPage({
        page: approvalChangeDataPage(result),
        flags,
        locale,
        view: presentationView,
        color,
      });
    } else fail("USAGE_ERROR", 2, "Unknown approval command.");
    return true;
  }
  return false;
}
