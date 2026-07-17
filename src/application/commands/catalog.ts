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
    id: "doctor",
    path: ["doctor"],
    summaryKey: "command.doctor",
    fields: [],
    interaction: "never",
  },
  {
    id: "config",
    path: ["config"],
    summaryKey: "command.config",
    fields: [],
    interaction: "when-incomplete",
  },
  {
    id: "adapters",
    path: ["adapters"],
    summaryKey: "command.adapters",
    fields: [],
    interaction: "when-incomplete",
  },
  {
    id: "adapter",
    path: ["adapter"],
    summaryKey: "command.adapter",
    fields: [{ name: "adapter-id", required: true }],
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
    id: "device",
    path: ["device"],
    summaryKey: "command.device",
    fields: [{ name: "device-instance", required: true }],
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
    id: "system",
    path: ["system"],
    summaryKey: "command.system",
    fields: [{ name: "system-instance", required: true }],
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
    id: "run",
    path: ["run"],
    summaryKey: "command.run",
    fields: [{ name: "run-id", required: true }],
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
    id: "lock",
    path: ["lock"],
    summaryKey: "command.lock",
    fields: [{ name: "lock-id", required: true }],
    interaction: "when-incomplete",
  },
  {
    id: "approvals",
    path: ["approvals"],
    summaryKey: "command.approvals",
    fields: [],
    interaction: "when-incomplete",
  },
  {
    id: "approval",
    path: ["approval"],
    summaryKey: "command.approval",
    fields: [{ name: "approval-id", required: true }],
    interaction: "when-incomplete",
  },
  {
    id: "help",
    path: ["help"],
    summaryKey: "command.help",
    fields: [],
    interaction: "never",
  },
];

export const approvalApproveNode: CommandNode = {
  id: "approval.approve",
  path: ["approval", "<approval-id>", "approve"],
  summaryKey: "command.approval.approve",
  fields: [{ name: "approval-id", required: true }],
  interaction: "required",
};
