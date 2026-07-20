import type { CommandIntent } from "../../application/commands/contracts.js";
import type { CommandDispatcher } from "../../application/commands/dispatcher.js";
import type { RuntimeCommandUseCases } from "../../application/runtime/command-use-case.js";
import type { LockLiveness, LockRecord } from "../../core.js";
import type { Locale } from "../../i18n/index.js";
import {
  approvalDetailDataPage,
  type ApprovalScreenPresentation,
} from "../data/approval.js";
import { lockDetailDataPage } from "../data/lock.js";
import { outcomeDataPage } from "../data/outcome-page.js";
import { renderDataPage } from "../output/data-page-renderer.js";
import type { Flags } from "../parser.js";

interface RuntimeCommandContext {
  readonly flags: Flags;
  readonly intent: CommandIntent;
  readonly dispatcher: CommandDispatcher;
  readonly locale: Locale;
  readonly color: boolean;
  readonly runtimeCommands: RuntimeCommandUseCases;
  readonly approvalPresentation?: ApprovalScreenPresentation;
  readonly confirmApproval: (input: {
    approvalId: string;
    action: "approve" | "reject";
  }) => Promise<boolean>;
  readonly confirmLockClear?: (input: {
    lockId: string;
    state: LockRecord["state"];
    liveness: LockLiveness;
  }) => Promise<boolean>;
}

/** Executes the three administrative recipes that require a human confirmation. */
export async function handleRuntimeCommand(
  context: RuntimeCommandContext,
): Promise<boolean> {
  const { intent } = context;
  if (intent.commandId === "lock.clear") {
    const lockId = String(intent.input.lock);
    let clearActive = intent.options["dangerously-clear-active-lock"] === true;
    let clearQuarantined =
      intent.options["dangerously-clear-quarantined-lock"] === true;
    if (!clearActive && !clearQuarantined) {
      const inspected = (
        await context.runtimeCommands.execute({
          action: "lock.show",
          id: lockId,
        })
      ).data as unknown as LockRecord & { liveness: LockLiveness };
      const needsConfirmation =
        inspected.state === "quarantined" ||
        inspected.state === "quarantine-failed" ||
        inspected.liveness !== "stale";
      if (needsConfirmation && context.confirmLockClear) {
        renderDataPage({
          command: { id: "lock.inspect", path: ["lock", lockId, "inspect"] },
          page: lockDetailDataPage(inspected),
          flags: context.flags,
          locale: context.locale,
          color: context.color,
        });
        if (
          !(await context.confirmLockClear({
            lockId,
            state: inspected.state,
            liveness: inspected.liveness,
          }))
        )
          return true;
        clearQuarantined =
          inspected.state === "quarantined" ||
          inspected.state === "quarantine-failed";
        clearActive = !clearQuarantined;
      }
    }
    const nextIntent: CommandIntent = {
      ...intent,
      options: {
        ...intent.options,
        "dangerously-clear-active-lock": clearActive,
        "dangerously-clear-quarantined-lock": clearQuarantined,
      },
    };
    const outcome = await context.dispatcher.dispatch(nextIntent);
    renderDataPage({
      command: { id: intent.commandId, path: [...intent.path] },
      page: outcomeDataPage(nextIntent, outcome),
      flags: context.flags,
      locale: context.locale,
      color: context.color,
    });
    return true;
  }

  if (
    intent.commandId === "approval.approve" ||
    intent.commandId === "approval.reject"
  ) {
    const approvalId = String(intent.input.approval);
    const action =
      intent.commandId === "approval.approve" ? "approve" : "reject";
    const approval = (
      await context.runtimeCommands.execute({
        action: "approval.inspect",
        id: approvalId,
      })
    ).data as unknown as Parameters<typeof approvalDetailDataPage>[0];
    renderDataPage({
      command: {
        id: "approval.inspect",
        path: ["approval", approvalId, "inspect"],
      },
      page: approvalDetailDataPage(approval, context.approvalPresentation),
      flags: context.flags,
      locale: context.locale,
      color: context.color,
    });
    if (!(await context.confirmApproval({ approvalId, action }))) return true;
    const outcome = await context.dispatcher.dispatch(intent);
    renderDataPage({
      command: { id: intent.commandId, path: [...intent.path] },
      page: outcomeDataPage(intent, outcome),
      flags: context.flags,
      locale: context.locale,
      color: context.color,
    });
    return true;
  }
  return false;
}
