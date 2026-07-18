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

export const rootHelpSections: readonly RootHelpSection[] = [
  {
    titleKey: "screen.root.interactive",
    entries: [{ command: "home", summaryKey: "help.command.home" }],
  },
  {
    titleKey: "screen.root.getStarted",
    entries: [
      { command: "init", summaryKey: "help.command.init" },
      { command: "setup", summaryKey: "screen.root.setup" },
      { command: "doctor", summaryKey: "help.command.doctor" },
      { command: "language", summaryKey: "screen.root.language" },
    ],
  },
  {
    titleKey: "screen.root.configure",
    entries: [
      { command: "config", summaryKey: "screen.root.config" },
      { command: "adapter", summaryKey: "screen.root.adapter" },
    ],
  },
  {
    titleKey: "screen.root.execute",
    entries: [
      {
        command: "device",
        summaryKey: "help.command.device",
      },
      {
        command: "system",
        summaryKey: "help.command.system",
      },
      { command: "workflow", summaryKey: "screen.root.workflow" },
    ],
  },
  {
    titleKey: "screen.root.records",
    entries: [
      { command: "run", summaryKey: "screen.root.run" },
      { command: "approval", summaryKey: "screen.root.approval" },
      { command: "lock", summaryKey: "screen.root.lock" },
    ],
  },
  {
    titleKey: "screen.root.help",
    entries: [
      { command: "skill", summaryKey: "screen.root.skill" },
      { command: "docs", summaryKey: "screen.root.docs" },
      { command: "help", summaryKey: "help.command.help" },
      { command: "version", summaryKey: "help.command.version" },
    ],
  },
];

const sections = rootHelpSections;
const rootEntryWidth = Math.max(
  ...sections.flatMap((section) =>
    section.entries.map((entry) => entry.command.length),
  ),
);
const commonOptions = [
  { option: "--json", summaryKey: "screen.root.optionJson" },
  { option: "--jsonl", summaryKey: "screen.root.optionJsonl" },
  { option: "--config <path>", summaryKey: "screen.root.optionConfig" },
  {
    option: "--agent",
    summaryKey: "screen.root.optionAgent",
  },
  { option: "--help", summaryKey: "screen.root.optionHelp" },
] as const;
const rootColumnWidth = Math.max(
  rootEntryWidth,
  ...commonOptions.map(({ option }) => option.length),
);

function renderEntries(
  entries: readonly RootHelpEntry[],
  locale: Locale,
  color: boolean,
) {
  const theme = terminalTheme(color);
  return entries
    .map(
      (entry) =>
        `  ${renderCommandPath(entry.command.padEnd(rootColumnWidth), theme)}  ${t(locale, entry.summaryKey)}`,
    )
    .join("\n");
}

function renderCommandPath(
  command: string,
  theme: ReturnType<typeof terminalTheme>,
) {
  return command
    .split(/(<[^>]+>|\[[^\]]+\])/)
    .map((part) => {
      if (part.startsWith("<") && part.endsWith(">"))
        return theme.command(part);
      if (part.startsWith("[") && part.endsWith("]"))
        return theme.optional(part);
      return part
        .split(/(\s+)/)
        .map((token) => (/^\s+$/.test(token) ? token : theme.command(token)))
        .join("");
    })
    .join("");
}

function renderExample(
  theme: ReturnType<typeof terminalTheme>,
  parts: ReadonlyArray<{
    value: string;
    kind: "command" | "argument" | "flag";
  }>,
) {
  return parts
    .map(({ value, kind }) => {
      if (kind === "argument") return theme.argument(value);
      if (kind === "flag") return theme.flag(value);
      return theme.command(value);
    })
    .join(" ");
}

function renderOption(option: string, theme: ReturnType<typeof terminalTheme>) {
  const match = /^(--\S+)(\s+)(<[^>]+>)$/.exec(option);
  if (!match) return theme.flag(option);
  return `${theme.flag(match[1])}${match[2]}${theme.argument(match[3])}`;
}

function renderOptions(
  options: readonly (typeof commonOptions)[number][],
  locale: Locale,
  theme: ReturnType<typeof terminalTheme>,
) {
  return options
    .map(
      ({ option, summaryKey }) =>
        `  ${renderOption(option, theme)}${" ".repeat(rootColumnWidth - option.length)}  ${t(locale, summaryKey)}`,
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
  return `${theme.brand(benchPilotWordmark)}\n\n${theme.muted(t(locale, "help.group.root"))}\n\n${theme.heading(t(locale, "help.usage"))}\n  ${theme.executable("benchpilot")} ${theme.command("<command>")} ${theme.command("[arguments]")} ${theme.optional("[options]")}\n\n${sections
    .map(
      (section) =>
        `${theme.heading(t(locale, section.titleKey))}\n${renderEntries(section.entries, locale, color)}`,
    )
    .join(
      "\n\n",
    )}\n\n${theme.heading(t(locale, "screen.root.commonOptions"))}\n${renderOptions(commonOptions, locale, theme)}\n\n${theme.heading(t(locale, "help.examples"))}\n  ${theme.muted("$")} ${theme.executable("benchpilot")} ${renderExample(
    theme,
    [
      { value: "device", kind: "command" },
      { value: "scan", kind: "command" },
    ],
  )}\n  ${theme.muted("$")} ${theme.executable("benchpilot")} ${renderExample(
    theme,
    [
      { value: "device", kind: "command" },
      { value: "demo", kind: "argument" },
      { value: "deploy", kind: "command" },
    ],
  )}\n  ${theme.muted("$")} ${theme.executable("benchpilot")} ${renderExample(
    theme,
    [
      { value: "device", kind: "command" },
      { value: "demo", kind: "argument" },
      { value: "deploy", kind: "command" },
      { value: "--json", kind: "flag" },
    ],
  )}\n\n${theme.muted(t(locale, "screen.root.more"))}\n${theme.muted(t(locale, "screen.root.repository"))}\n`;
}
