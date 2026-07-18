const globalOptions = [
  "--config <path>",
  "--json",
  "--jsonl",
  "--quiet",
  "--verbose",
  "--timeout <duration>",
  "--dry-run",
  "--agent",
  "--no-color",
  "--session <name>",
  "--help",
  "--version",
];

import { t, type Locale, type MessageKey } from "../i18n/index.js";
import { commandRoots } from "../application/commands/catalog.js";
import { renderRootHelp } from "./presentation/root-help.js";

type CommandGroup = { summaryKey: MessageKey; children: readonly string[] };

const groups = {
  root: {
    summaryKey: "help.group.root",
    children: [
      "init",
      "doctor",
      "language",
      "config",
      "adapter",
      "device",
      "system",
      "run",
      "lock",
      "approval",
      "help",
      "home",
      "version",
    ],
  },
  config: {
    summaryKey: "help.group.config",
    children: ["get", "set", "unset", "resolved", "explain", "validate"],
  },
  language: {
    summaryKey: "help.group.language",
    children: ["list", "get", "set"],
  },
  adapter: {
    summaryKey: "help.group.adapter",
    children: ["list", "<adapter-id>"],
  },
  device: {
    summaryKey: "help.group.device",
    children: ["list", "scan", "<device-instance>"],
  },
  system: {
    summaryKey: "help.group.system",
    children: ["list", "<system-instance>"],
  },
  run: {
    summaryKey: "help.group.run",
    children: ["list", "prune", "<run-id>"],
  },
  lock: {
    summaryKey: "help.group.lock",
    children: ["list", "clear-stale", "<lock-id>"],
  },
  approval: {
    summaryKey: "help.group.approval",
    children: ["list", "<approval-id>"],
  },
  version: { summaryKey: "help.group.version", children: [] },
  home: { summaryKey: "help.group.home", children: [] },
} as const satisfies Record<string, CommandGroup>;

type CommandGroupName = keyof typeof groups;
type CommandChild = (typeof groups)[CommandGroupName]["children"][number];
type CommandName = Exclude<CommandChild, `<${string}>`>;

function isCommandPlaceholder(
  child: CommandChild,
): child is Extract<CommandChild, `<${string}>`> {
  return child.startsWith("<");
}

function groupFor(name: string) {
  return isCommandGroup(name) ? groups[name] : groups.root;
}

const commandSummaryKeys = {
  config: "help.command.config",
  get: "help.command.get",
  set: "help.command.set",
  unset: "help.command.unset",
  resolved: "help.command.resolved",
  explain: "help.command.explain",
  validate: "help.command.validate",
  list: "help.command.list",
  scan: "help.command.scan",
  init: "help.command.init",
  doctor: "help.command.doctor",
  language: "help.command.language",
  prune: "help.command.prune",
  "clear-stale": "help.command.clear-stale",
  adapter: "help.command.adapter",
  device: "help.command.device",
  system: "help.command.system",
  run: "help.command.run",
  lock: "help.command.lock",
  approval: "help.command.approval",
  help: "help.command.help",
  home: "help.command.home",
  version: "help.command.version",
} as const satisfies Record<CommandName, MessageKey>;

function summary(child: CommandChild, locale: Locale) {
  if (isCommandPlaceholder(child)) return child;
  return t(locale, commandSummaryKeys[child]);
}

export function brief(
  name: string,
  locale: Locale = "en",
  color = false,
  showWordmark = true,
) {
  if (name === "root") return renderRootHelp(locale, color, showWordmark);
  const group = groupFor(name);
  const command = name === "root" ? "benchpilot" : `benchpilot ${name}`;
  return `${command} — ${t(locale, group.summaryKey)}\n\n${t(locale, "help.usage")}: ${command} <command>\n\n${t(locale, "help.commands")}:\n${group.children.map((child) => `  ${child.padEnd(17)} ${summary(child, locale)}`).join("\n")}\n\n${t(locale, "help.globalOptions")}: ${globalOptions.slice(0, 5).join("  ")}\n${t(locale, "help.more", { command })}\n`;
}

export function fullHelp(parts: string[]) {
  const command = ["benchpilot", ...parts].join(" ");
  return {
    schema: "benchpilot.help",
    version: 2,
    path: parts,
    summary: t("en", groupFor(parts.at(-1) || "root").summaryKey),
    description:
      "Command definitions drive parsing, help, validation, safety and execution.",
    arguments: [],
    options: globalOptions,
    safety: { mode: "normal" },
    errors: ["USAGE_ERROR", "CONFIG_ERROR", "DEVICE_BUSY", "OPERATION_TIMEOUT"],
    examples: [`${command} --json`],
  };
}

export function humanFull(parts: string[], locale: Locale = "en") {
  const help = fullHelp(parts);
  const command = ["benchpilot", ...parts].join(" ");
  return `${t(locale, "help.name")}\n  ${command} — ${t(locale, groupFor(parts.at(-1) || "root").summaryKey)}\n\n${t(locale, "help.synopsis")}\n  ${command} [OPTIONS]\n\n${t(locale, "help.description")}\n  ${t(locale, "help.descriptionText")}\n\n${t(locale, "help.workflow")}\n  ${t(locale, "help.workflowText")}\n\n${t(locale, "help.arguments")}\n  ${t(locale, "help.argumentsText")}\n\n${t(locale, "help.options")}\n  ${globalOptions.join("\n  ")}\n\n${t(locale, "help.configuration")}\n  ${t(locale, "help.configurationText")}\n\n${t(locale, "help.output")}\n  ${t(locale, "help.outputText")}\n\n${t(locale, "help.safety")}\n  ${JSON.stringify(help.safety)}\n\n${t(locale, "help.exitCodes")}\n  ${t(locale, "help.exitCodesText")}\n\n${t(locale, "help.errorKinds")}\n  ${help.errors.join(", ")}\n\n${t(locale, "help.examples")}\n  ${help.examples.join("\n  ")}\n\n${t(locale, "help.seeAlso")}\n  benchpilot help --all\n`;
}

export const commandGroups = commandRoots.map((command) => command.path[0]!);
export function isCommandGroup(
  name: string | undefined,
): name is CommandGroupName {
  return Boolean(name && name in groups);
}
