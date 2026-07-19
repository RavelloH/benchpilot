import { t, type Locale, type MessageKey } from "../../i18n/index.js";
import type { PromptItem } from "../interaction/prompter.js";
import { benchPilotWordmark as rootWordmark } from "./brand.js";
import { screenPresentation, type CliNode } from "./page.js";
import { terminalTheme } from "./theme.js";

type RootHelpEntry = {
  command: string;
  summaryKey: MessageKey;
};

type RootHelpSection = {
  titleKey: MessageKey;
  entries: readonly RootHelpEntry[];
};

export type AgentHelpEntry = RootHelpEntry & {
  syntax: string;
  usages?: readonly string[];
};

export type AgentHelpSection = {
  titleKey: MessageKey;
  entries: readonly AgentHelpEntry[];
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
      { command: "alias", summaryKey: "screen.root.alias" },
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
        summaryKey: "screen.root.device",
      },
      {
        command: "system",
        summaryKey: "screen.root.system",
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
      { command: "upgrade", summaryKey: "screen.root.upgrade" },
      { command: "help", summaryKey: "help.command.help" },
      { command: "version", summaryKey: "help.command.version" },
    ],
  },
];

export const agentHelpSections: readonly AgentHelpSection[] = [
  {
    titleKey: "screen.root.getStarted",
    entries: [
      {
        command: "init",
        summaryKey: "help.command.init",
        syntax:
          "benchpilot init --project-id <project-id> --project-name <project-name> --locale <locale> [options]",
      },
      {
        command: "setup",
        summaryKey: "screen.root.setup",
        syntax: "benchpilot setup [arguments] [options]",
      },
      {
        command: "doctor",
        summaryKey: "help.command.doctor",
        syntax: "benchpilot doctor [options]",
      },
      {
        command: "language",
        summaryKey: "screen.root.language",
        syntax: "benchpilot language <list|get|set> [locale] [options]",
        usages: [
          "benchpilot language list [options]",
          "benchpilot language get [options]",
          "benchpilot language set <locale> [options]",
        ],
      },
      {
        command: "alias",
        summaryKey: "screen.root.alias",
        syntax: "benchpilot alias [arguments] [options]",
      },
    ],
  },
  {
    titleKey: "screen.root.configure",
    entries: [
      {
        command: "config",
        summaryKey: "screen.root.config",
        syntax:
          "benchpilot config <get|set|unset|resolved|explain|validate> [arguments] [options]",
        usages: [
          "benchpilot config get <key> [options]",
          "benchpilot config set <key> <value> [options]",
          "benchpilot config set approval.level <default|strict|bypass> [options]",
          "benchpilot config unset <key> [options]",
          "benchpilot config resolved [options]",
          "benchpilot config explain <key> [options]",
          "benchpilot config validate [options]",
        ],
      },
      {
        command: "adapter",
        summaryKey: "screen.root.adapter",
        syntax: "benchpilot adapter <list|adapter-id> [action] [options]",
        usages: [
          "benchpilot adapter list [options]",
          "benchpilot adapter <adapter-id> show [options]",
          "benchpilot adapter <adapter-id> doctor [options]",
        ],
      },
    ],
  },
  {
    titleKey: "screen.root.execute",
    entries: [
      {
        command: "device",
        summaryKey: "screen.root.device",
        syntax:
          "benchpilot device <list|scan|device-instance> [capability] [arguments] [options]",
        usages: [
          "benchpilot device list [options]",
          "benchpilot device scan [options]",
          "benchpilot device <device-instance> <capability> [arguments] [options]",
        ],
      },
      {
        command: "system",
        summaryKey: "screen.root.system",
        syntax:
          "benchpilot system <list|system-instance> [capability] [arguments] [options]",
        usages: [
          "benchpilot system list [options]",
          "benchpilot system <system-instance> <capability> [arguments] [options]",
        ],
      },
      {
        command: "workflow",
        summaryKey: "screen.root.workflow",
        syntax: "benchpilot workflow [arguments] [options]",
        usages: [
          "benchpilot workflow list [options]",
          "benchpilot workflow <workflow> run [arguments] [options]",
        ],
      },
    ],
  },
  {
    titleKey: "screen.root.records",
    entries: [
      {
        command: "run",
        summaryKey: "screen.root.run",
        syntax:
          "benchpilot run <list|prune|run-id> [show|logs|artifacts] [options]",
        usages: [
          "benchpilot run list [options]",
          "benchpilot run prune [options]",
          "benchpilot run <run-id> show [options]",
          "benchpilot run <run-id> logs [options]",
          "benchpilot run <run-id> artifacts [options]",
        ],
      },
      {
        command: "approval",
        summaryKey: "screen.root.approval",
        syntax:
          "benchpilot approval <list|approval-id> [inspect|approve|reject] [options]",
        usages: [
          "benchpilot approval list [options]",
          "benchpilot approval <approval-id> inspect [options]",
          "benchpilot approval <approval-id> approve [options]",
          "benchpilot approval <approval-id> reject [options]",
        ],
      },
      {
        command: "lock",
        summaryKey: "screen.root.lock",
        syntax:
          "benchpilot lock <list|clear-stale|lock-id> [show|clear] [options]",
        usages: [
          "benchpilot lock list [options]",
          "benchpilot lock clear-stale [options]",
          "benchpilot lock <lock-id> show [options]",
          "benchpilot lock <lock-id> clear [options]",
        ],
      },
    ],
  },
  {
    titleKey: "screen.root.help",
    entries: [
      {
        command: "skill",
        summaryKey: "screen.root.skill",
        syntax: "benchpilot skill [arguments] [options]",
      },
      {
        command: "docs",
        summaryKey: "screen.root.docs",
        syntax: "benchpilot docs [arguments] [options]",
      },
      {
        command: "upgrade",
        summaryKey: "screen.root.upgrade",
        syntax: "benchpilot upgrade [options]",
      },
      {
        command: "help",
        summaryKey: "help.command.help",
        syntax: "benchpilot help [command] [options]",
      },
      {
        command: "version",
        summaryKey: "help.command.version",
        syntax: "benchpilot version [options]",
      },
    ],
  },
];

/** Flatten the root command index into one grouped Inquirer selection menu. */
export function rootMenuChoices(
  locale: Locale,
  color = false,
): readonly PromptItem[] {
  const theme = terminalTheme(color);
  return rootHelpSections
    .filter((section) => section.titleKey !== "screen.root.interactive")
    .flatMap((section) => [
      { separator: theme.heading(t(locale, section.titleKey)) },
      ...section.entries.map((entry) => ({
        value: entry.command.split(" ")[0]!,
        label: `${theme.command(entry.command.padEnd(rootEntryWidth))}  ${t(locale, entry.summaryKey)}`,
      })),
    ]);
}

/** Header shown above the persistent, searchable interactive command menu. */
export function renderInteractiveHomeHeader(
  locale: Locale,
  color: boolean,
  showWordmark: boolean,
) {
  const theme = terminalTheme(color);
  const benchPilotWordmark = showWordmark ? rootWordmark : "";
  return `${theme.brand(benchPilotWordmark)}\n\n${theme.muted(t(locale, "help.group.root"))}\n\n`;
}

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

const visibleEverywhere = ["screen", "json", "jsonl"] as const;

const sectionNames = {
  "screen.root.interactive": "interactive",
  "screen.root.getStarted": "get-started",
  "screen.root.configure": "environment-and-integration",
  "screen.root.execute": "resources-and-orchestration",
  "screen.root.records": "audit-and-safety",
  "screen.root.help": "help",
} as const satisfies Partial<Record<MessageKey, string>>;

function sectionName(key: MessageKey) {
  return (sectionNames as Partial<Record<MessageKey, string>>)[key] ?? key;
}

function renderSyntax(value: string, theme: ReturnType<typeof terminalTheme>) {
  const [executable, ...rest] = value.split(" ");
  return `${theme.executable(executable!)} ${renderCommandPath(rest.join(" "), theme)}`;
}

function agentRootHelpPage(locale: Locale, color: boolean): readonly CliNode[] {
  const theme = terminalTheme(color);
  return [
    {
      name: "introduction",
      visibility: visibleEverywhere,
      text: theme.muted(t(locale, "help.group.root")),
    },
    {
      name: "command",
      visibility: visibleEverywhere,
      children: [
        {
          name: "usage",
          visibility: visibleEverywhere,
          lineBreak: true,
          text: theme.heading(t(locale, "help.usage")),
          children: [
            {
              name: "syntax",
              visibility: visibleEverywhere,
              text: renderSyntax(
                "benchpilot <command> [arguments] [options]",
                theme,
              ),
            },
          ],
        },
        ...agentHelpSections.map((section) => ({
          name: sectionName(section.titleKey),
          visibility: visibleEverywhere,
          lineBreak: true,
          text: theme.heading(t(locale, section.titleKey)),
          children: section.entries.map((entry, index) => ({
            name: entry.command,
            visibility: visibleEverywhere,
            lineBreak: index < section.entries.length - 1,
            text: renderSyntax(entry.syntax, theme),
            children: [
              {
                name: "description",
                visibility: visibleEverywhere,
                text: t(locale, entry.summaryKey),
              },
              ...(entry.usages ?? []).map((usage, index) => ({
                name: `usage-${index + 1}`,
                visibility: visibleEverywhere,
                text: renderSyntax(usage, theme),
              })),
            ],
          })),
        })),
        {
          name: "global-options",
          visibility: visibleEverywhere,
          text: theme.heading(t(locale, "screen.root.commonOptions")),
          children: commonOptions.map(({ option, summaryKey }) => ({
            name: option.slice(2).replace(/\s+<(.+)>/, "-$1"),
            visibility: visibleEverywhere,
            text: `${renderOption(option, theme)}  ${t(locale, summaryKey)}`,
          })),
        },
      ],
    },
    {
      name: "more",
      visibility: visibleEverywhere,
      children: [
        {
          name: "detailed-help",
          visibility: visibleEverywhere,
          text: theme.muted(t(locale, "screen.root.more")),
        },
      ],
    },
  ];
}

/** Structured root command index for screen, JSON, and JSONL projection. */
export function rootHelpPage(
  locale: Locale = "en",
  color = false,
  showWordmark = true,
  view: "normal" | "agent" = "normal",
): readonly CliNode[] {
  if (view === "agent") return agentRootHelpPage(locale, color);
  const theme = terminalTheme(color);
  const sectionNodes: CliNode[] = sections.map((section) => {
    const name = sectionName(section.titleKey);
    return {
      name,
      visibility: visibleEverywhere,
      lineBreak: true,
      text: theme.heading(t(locale, section.titleKey)),
      children: section.entries.map((entry) => ({
        name: entry.command,
        visibility: visibleEverywhere,
        text: `${renderCommandPath(entry.command.padEnd(rootColumnWidth), theme)}  ${t(locale, entry.summaryKey)}`,
      })),
    };
  });
  const examples = [
    [
      { value: "device", kind: "command" as const },
      { value: "scan", kind: "command" as const },
    ],
    [
      { value: "device", kind: "command" as const },
      { value: "demo", kind: "argument" as const },
      { value: "deploy", kind: "command" as const },
    ],
    [
      { value: "device", kind: "command" as const },
      { value: "demo", kind: "argument" as const },
      { value: "deploy", kind: "command" as const },
      { value: "--json", kind: "flag" as const },
    ],
  ];
  return [
    ...(showWordmark
      ? [
          {
            name: "logo",
            visibility: ["screen"] as const,
            text: theme.brand(rootWordmark),
          },
        ]
      : []),
    {
      name: "introduction",
      visibility: visibleEverywhere,
      text: theme.muted(t(locale, "help.group.root")),
    },
    {
      name: "command",
      visibility: visibleEverywhere,
      children: [
        {
          name: "usage",
          visibility: visibleEverywhere,
          lineBreak: true,
          text: theme.heading(t(locale, "help.usage")),
          children: [
            {
              name: "syntax",
              visibility: visibleEverywhere,
              text: `${theme.executable("benchpilot")} ${theme.command("<command>")} ${theme.command("[arguments]")} ${theme.optional("[options]")}`,
            },
          ],
        },
        ...sectionNodes,
        {
          name: "global-options",
          visibility: visibleEverywhere,
          lineBreak: true,
          text: theme.heading(t(locale, "screen.root.commonOptions")),
          children: commonOptions.map(({ option, summaryKey }) => {
            const name = option.slice(2).replace(/\s+<(.+)>/, "-$1");
            return {
              name,
              visibility: visibleEverywhere,
              text: `${renderOption(option, theme)}${" ".repeat(rootColumnWidth - option.length)}  ${t(locale, summaryKey)}`,
            };
          }),
        },
        {
          name: "examples",
          visibility: visibleEverywhere,
          text: theme.heading(t(locale, "help.examples")),
          children: examples.map((example, index) => ({
            name: `example-${index + 1}`,
            visibility: visibleEverywhere,
            text: `${theme.muted("$")} ${theme.executable("benchpilot")} ${renderExample(theme, example)}`,
          })),
        },
      ],
    },
    {
      name: "more",
      visibility: visibleEverywhere,
      children: [
        {
          name: "detailed-help",
          visibility: visibleEverywhere,
          text: theme.muted(t(locale, "screen.root.more")),
        },
        {
          name: "repository",
          visibility: visibleEverywhere,
          text: theme.muted(t(locale, "screen.root.repository")),
        },
      ],
    },
  ];
}

/** Human-first root screen. Machine help remains the stable help DTO. */
export function renderRootHelp(
  locale: Locale = "en",
  color = false,
  showWordmark = true,
) {
  return screenPresentation(rootHelpPage(locale, color, showWordmark));
}
