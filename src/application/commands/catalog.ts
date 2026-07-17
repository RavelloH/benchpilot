import type { CommandNode } from "./contracts.js";

/** Static roots; Application may append context-dependent children at query time. */
export const commandRoots: readonly CommandNode[] = [
  {
    id: "init",
    path: ["init"],
    summaryKey: "command.init",
    fields: [
      { name: "project-id", required: true },
      { name: "project-name", required: true },
      { name: "locale", required: true },
    ],
    interaction: "when-incomplete",
  },
  {
    id: "config",
    path: ["config"],
    summaryKey: "command.config",
    fields: [],
    interaction: "when-incomplete",
  },
  {
    id: "devices",
    path: ["devices"],
    summaryKey: "command.devices",
    fields: [],
    interaction: "when-incomplete",
  },
  {
    id: "systems",
    path: ["systems"],
    summaryKey: "command.systems",
    fields: [],
    interaction: "when-incomplete",
  },
  {
    id: "runs",
    path: ["runs"],
    summaryKey: "command.runs",
    fields: [],
    interaction: "when-incomplete",
  },
  {
    id: "locks",
    path: ["locks"],
    summaryKey: "command.locks",
    fields: [],
    interaction: "when-incomplete",
  },
  {
    id: "approvals",
    path: ["approvals"],
    summaryKey: "command.approvals",
    fields: [],
    interaction: "when-incomplete",
  },
];

export const approvalApproveNode: CommandNode = {
  id: "approval.approve",
  path: ["approval", "<approval-id>", "approve"],
  summaryKey: "command.approval.approve",
  fields: [{ name: "approval-id", required: true }],
  interaction: "required",
};
