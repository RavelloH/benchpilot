const globalOptions = [
  "--config <path>",
  "--json",
  "--jsonl",
  "--quiet",
  "--verbose",
  "--timeout <duration>",
  "--dry-run",
  "--no-color",
  "--session <name>",
  "--help",
  "--version",
];

import { t, type Locale } from "../i18n/index.js";
import { commandRoots } from "../application/commands/catalog.js";

const groups: Record<string, { summaryKey: string; children: string[] }> = {
  root: {
    summaryKey: "help.group.root",
    children: [
      "init",
      "doctor",
      "config",
      "adapters",
      "adapter",
      "devices",
      "device",
      "systems",
      "system",
      "runs",
      "run",
      "locks",
      "lock",
      "approvals",
      "approval",
      "help",
    ],
  },
  config: {
    summaryKey: "help.group.config",
    children: ["get", "set", "unset", "resolved", "explain", "validate"],
  },
  adapters: {
    summaryKey: "help.group.adapters",
    children: ["list"],
  },
  adapter: { summaryKey: "help.group.adapter", children: ["<adapter-id>"] },
  devices: {
    summaryKey: "help.group.devices",
    children: ["list", "scan"],
  },
  device: {
    summaryKey: "help.group.device",
    children: ["<device-instance>"],
  },
  systems: { summaryKey: "help.group.systems", children: ["list"] },
  system: {
    summaryKey: "help.group.system",
    children: ["<system-instance>"],
  },
  runs: {
    summaryKey: "help.group.runs",
    children: ["list", "prune"],
  },
  run: { summaryKey: "help.group.run", children: ["<run-id>"] },
  locks: {
    summaryKey: "help.group.locks",
    children: ["list", "clear-stale"],
  },
  lock: { summaryKey: "help.group.lock", children: ["<lock-id>"] },
  approvals: { summaryKey: "help.group.approvals", children: [] },
  approval: {
    summaryKey: "help.group.approval",
    children: ["<approval-id>"],
  },
};

function summary(child: string, locale: Locale) {
  return t(locale, `help.command.${child}`);
}

export function brief(name: string, locale: Locale = "en") {
  const group = groups[name] || groups.root;
  const command = name === "root" ? "benchpilot" : `benchpilot ${name}`;
  return `${command} — ${t(locale, group.summaryKey)}\n\n${t(locale, "help.usage")}: ${command} <command>\n\n${t(locale, "help.commands")}:\n${group.children.map((child) => `  ${child.padEnd(17)} ${summary(child, locale)}`).join("\n")}\n\n${t(locale, "help.globalOptions")}: ${globalOptions.slice(0, 5).join("  ")}\n${t(locale, "help.more", { command })}\n`;
}

export function fullHelp(parts: string[]) {
  const pathName = parts.join(" ") || "benchpilot";
  return {
    schema: "benchpilot.help",
    version: 2,
    path: parts,
    summary: t(
      "en",
      groups[parts.at(-1) || "root"]?.summaryKey || "help.group.root",
    ),
    description:
      "Command definitions drive parsing, help, validation, safety and execution.",
    arguments: [],
    options: globalOptions,
    safety: { mode: "normal" },
    errors: ["USAGE_ERROR", "CONFIG_ERROR", "DEVICE_BUSY", "OPERATION_TIMEOUT"],
    examples: [`benchpilot ${pathName} --json`],
  };
}

export function humanFull(parts: string[], locale: Locale = "en") {
  const help = fullHelp(parts);
  const displayName = parts.join(" ");
  return `${t(locale, "help.name")}\n  benchpilot ${displayName} — ${t(locale, groups[parts.at(-1) || "root"]?.summaryKey || "help.group.root")}\n\n${t(locale, "help.synopsis")}\n  benchpilot ${displayName} [OPTIONS]\n\n${t(locale, "help.description")}\n  ${t(locale, "help.descriptionText")}\n\n${t(locale, "help.workflow")}\n  ${t(locale, "help.workflowText")}\n\n${t(locale, "help.arguments")}\n  ${t(locale, "help.argumentsText")}\n\n${t(locale, "help.options")}\n  ${globalOptions.join("\n  ")}\n\n${t(locale, "help.configuration")}\n  ${t(locale, "help.configurationText")}\n\n${t(locale, "help.output")}\n  ${t(locale, "help.outputText")}\n\n${t(locale, "help.safety")}\n  ${JSON.stringify(help.safety)}\n\n${t(locale, "help.exitCodes")}\n  ${t(locale, "help.exitCodesText")}\n\n${t(locale, "help.errorKinds")}\n  ${help.errors.join(", ")}\n\n${t(locale, "help.examples")}\n  ${help.examples.join("\n  ")}\n\n${t(locale, "help.seeAlso")}\n  benchpilot help --all\n`;
}

export const commandGroups = commandRoots.map((command) => command.path[0]!);
export const isCommandGroup = (name: string | undefined) =>
  Boolean(name && groups[name]);
