import { t, type Locale, type MessageKey } from "../../i18n/index.js";
import { benchPilotWordmark as rootWordmark } from "./brand.js";
import { terminalTheme } from "./theme.js";

type RootHelpEntry = {
  command: string;
  summaryKey: MessageKey;
};

type RootHelpSection = {
  titleKey: MessageKey;
  entries: readonly RootHelpEntry[];
};

const sections: readonly RootHelpSection[] = [
  {
    titleKey: "screen.root.getStarted",
    entries: [
      { command: "init", summaryKey: "help.command.init" },
      { command: "doctor", summaryKey: "help.command.doctor" },
    ],
  },
  {
    titleKey: "screen.root.configure",
    entries: [
      { command: "config", summaryKey: "screen.root.config" },
      { command: "adapters", summaryKey: "screen.root.adapters" },
      { command: "adapter", summaryKey: "screen.root.adapter" },
      { command: "devices", summaryKey: "screen.root.devices" },
      { command: "systems", summaryKey: "screen.root.systems" },
    ],
  },
  {
    titleKey: "screen.root.execute",
    entries: [
      {
        command: "device <name> <capability>",
        summaryKey: "help.command.device",
      },
      {
        command: "system <name> <capability>",
        summaryKey: "help.command.system",
      },
    ],
  },
  {
    titleKey: "screen.root.records",
    entries: [
      { command: "runs", summaryKey: "screen.root.runs" },
      { command: "run", summaryKey: "screen.root.run" },
      { command: "approvals", summaryKey: "screen.root.approvals" },
      { command: "approval", summaryKey: "screen.root.approval" },
      { command: "locks", summaryKey: "screen.root.locks" },
      { command: "lock", summaryKey: "screen.root.lock" },
    ],
  },
  {
    titleKey: "screen.root.help",
    entries: [
      { command: "help", summaryKey: "help.command.help" },
      { command: "version", summaryKey: "help.command.version" },
    ],
  },
];

const commonOptions = [
  "--json",
  "--jsonl",
  "--config <path>",
  "--non-interactive",
  "--help",
] as const;

function renderEntries(
  entries: readonly RootHelpEntry[],
  locale: Locale,
  color: boolean,
) {
  const theme = terminalTheme(color);
  const width = Math.max(...entries.map((entry) => entry.command.length));
  return entries
    .map(
      (entry) =>
        `  ${theme.command(entry.command.padEnd(width))}  ${t(locale, entry.summaryKey)}`,
    )
    .join("\n");
}

/** Human-first root screen. Machine help remains the stable help DTO. */
export function renderRootHelp(
  locale: Locale = "en",
  color = false,
  showWordmark = true,
) {
  const theme = terminalTheme(color);
  const benchPilotWordmark = showWordmark ? rootWordmark : "";
  return `${theme.brand(benchPilotWordmark)}\n\n${theme.muted(t(locale, "help.group.root"))}\n\n${theme.heading(t(locale, "help.usage"))}\n  ${theme.command("benchpilot")} <command> [options]\n\n${sections
    .map(
      (section) =>
        `${theme.heading(t(locale, section.titleKey))}\n${renderEntries(section.entries, locale, color)}`,
    )
    .join(
      "\n\n",
    )}\n\n${theme.heading(t(locale, "screen.root.commonOptions"))}\n  ${commonOptions.map((option) => theme.option(option)).join("  ")}\n\n${theme.heading(t(locale, "help.examples"))}\n  ${theme.command("benchpilot devices scan")}\n  ${theme.command("benchpilot device demo deploy")}\n  ${theme.command("benchpilot device demo deploy --json")}\n\n${theme.muted(t(locale, "screen.root.more"))}\n`;
}
