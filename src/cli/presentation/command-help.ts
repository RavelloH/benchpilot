import { t, type Locale } from "../../i18n/index.js";
import { commandSummary, fullHelp } from "../help-renderer.js";
import { agentHelpSections } from "./root-help.js";
import { terminalTheme } from "./theme.js";
import type { CliNode } from "./page.js";

const visibleEverywhere = ["screen", "json", "jsonl"] as const;

function section(
  name: string,
  title: string,
  children: readonly CliNode[],
  lineBreak = false,
): CliNode {
  return {
    name,
    visibility: visibleEverywhere,
    lineBreak,
    text: title,
    children,
  };
}

function syntax(path: readonly string[]) {
  if (!path.length) return "benchpilot <command> [arguments] [options]";
  return `benchpilot ${path.join(" ")} [options]`;
}

function rootCommandReference(
  locale: Locale,
  theme: ReturnType<typeof terminalTheme>,
): CliNode {
  return {
    name: "commands",
    visibility: visibleEverywhere,
    children: agentHelpSections.map((group) => ({
      name: group.titleKey.replace("screen.root.", ""),
      visibility: visibleEverywhere,
      lineBreak: true,
      text: theme.heading(t(locale, group.titleKey)),
      children: group.entries.map((entry, index) => ({
        name: entry.command,
        visibility: visibleEverywhere,
        lineBreak: index < group.entries.length - 1,
        text: theme.command(entry.syntax),
        children: [
          {
            name: "description",
            visibility: visibleEverywhere,
            text: t(locale, entry.summaryKey),
          },
          ...(entry.usages ?? []).map((usage, index) => ({
            name: `usage-${index + 1}`,
            visibility: visibleEverywhere,
            text: theme.command(usage),
          })),
          {
            name: "detailed-help",
            visibility: visibleEverywhere,
            text: theme.command(`benchpilot ${entry.command} --help`),
          },
        ],
      })),
    })),
  };
}

function nestedCommandReference(
  path: readonly string[],
  locale: Locale,
  theme: ReturnType<typeof terminalTheme>,
): CliNode | undefined {
  const command = path[0];
  if (!command) return undefined;
  const entry = agentHelpSections
    .flatMap((section) => section.entries)
    .find((candidate) => candidate.command === command);
  if (!entry?.usages?.length) return undefined;
  return section(
    "commands",
    theme.heading(t(locale, "help.commands")),
    entry.usages.map((usage, index) => ({
      name: `usage-${index + 1}`,
      visibility: visibleEverywhere,
      text: theme.command(usage),
    })),
  );
}

/** Detailed, audience-neutral command reference for --help and help <command>. */
export function commandHelpPage(
  path: readonly string[],
  locale: Locale,
  color = false,
): readonly CliNode[] {
  const help = fullHelp([...path]);
  const command = ["benchpilot", ...path].join(" ");
  const theme = terminalTheme(color);
  const nestedReference = nestedCommandReference(path, locale, theme);
  return [
    section("name", theme.heading(t(locale, "help.name")), [
      {
        name: "command",
        visibility: visibleEverywhere,
        text: `${theme.executable(command)} — ${commandSummary(path, locale)}`,
      },
    ]),
    section("synopsis", theme.heading(t(locale, "help.synopsis")), [
      {
        name: "syntax",
        visibility: visibleEverywhere,
        text: theme.command(syntax(path)),
      },
    ]),
    ...(path.length === 0 ? [rootCommandReference(locale, theme)] : []),
    ...(nestedReference ? [nestedReference] : []),
    section("description", theme.heading(t(locale, "help.description")), [
      {
        name: "text",
        visibility: visibleEverywhere,
        text: t(locale, "help.descriptionText"),
      },
    ]),
    section("workflow", theme.heading(t(locale, "help.workflow")), [
      {
        name: "text",
        visibility: visibleEverywhere,
        text: t(locale, "help.workflowText"),
      },
    ]),
    section("arguments", theme.heading(t(locale, "help.arguments")), [
      {
        name: "text",
        visibility: visibleEverywhere,
        text: t(locale, "help.argumentsText"),
      },
    ]),
    section(
      "options",
      theme.heading(t(locale, "help.options")),
      help.options.map((option) => ({
        name: option.replace(/^-+/, "").replace(/\s+<(.+)>/, "-$1"),
        visibility: visibleEverywhere,
        text: theme.flag(option),
      })),
    ),
    section("configuration", theme.heading(t(locale, "help.configuration")), [
      {
        name: "text",
        visibility: visibleEverywhere,
        text: t(locale, "help.configurationText"),
      },
    ]),
    section("output", theme.heading(t(locale, "help.output")), [
      {
        name: "text",
        visibility: visibleEverywhere,
        text: t(locale, "help.outputText"),
      },
    ]),
    section("safety", theme.heading(t(locale, "help.safety")), [
      {
        name: "mode",
        visibility: visibleEverywhere,
        text: JSON.stringify(help.safety),
      },
    ]),
    section("exit-codes", theme.heading(t(locale, "help.exitCodes")), [
      {
        name: "text",
        visibility: visibleEverywhere,
        text: t(locale, "help.exitCodesText"),
      },
    ]),
    section(
      "error-kinds",
      theme.heading(t(locale, "help.errorKinds")),
      help.errors.map((error) => ({
        name: error.toLowerCase().replace(/_/g, "-"),
        visibility: visibleEverywhere,
        text: error,
      })),
    ),
    section(
      "examples",
      theme.heading(t(locale, "help.examples")),
      help.examples.map((example, index) => ({
        name: `example-${index + 1}`,
        visibility: visibleEverywhere,
        text: theme.command(example),
      })),
    ),
    section(
      "see-also",
      theme.heading(t(locale, "help.seeAlso")),
      [
        {
          name: "help-index",
          visibility: visibleEverywhere,
          text: theme.command("benchpilot help --all"),
        },
      ],
      false,
    ),
  ];
}
