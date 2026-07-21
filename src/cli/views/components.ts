import { t } from "../../i18n/index.js";
import type {
  HelpChildData,
  HelpData,
  HelpFieldData,
} from "../help/projector.js";
import { benchPilotWordmark } from "../presentation/brand.js";
import { terminalTheme, type TerminalTheme } from "../presentation/theme.js";
import { displayWidth } from "../terminal/text.js";
import type {
  ComponentRenderContext,
  HelpScreenComponent,
  HelpViewBlock,
} from "./types.js";

const section = (title: string, lines: readonly string[]) =>
  lines.length
    ? `${title}\n${lines.map((line) => `  ${line}`).join("\n")}`
    : "";

const padExact = (value: string, width: number) =>
  `${value}${" ".repeat(Math.max(0, width - displayWidth(value)))}`;

const commandLabel = (child: HelpChildData) => String(child.path[0] ?? "");
const commandSummary = (child: HelpChildData) =>
  child.navigationSummary?.text ?? child.summary.text;

const fieldName = (field: HelpFieldData) => {
  if (field.kind === "argument")
    return `<${field.name}${field.variadic === true ? "..." : ""}>`;
  const preferredAlias = (Array.isArray(field.aliases) ? field.aliases : [])
    .filter((alias): alias is string => typeof alias === "string")
    .map((alias) => alias.replace(/^--/, ""))
    .find((alias) => alias && alias !== field.name);
  const flag = preferredAlias ?? field.name;
  const placeholder =
    typeof field.placeholder === "string" ? field.placeholder : field.name;
  if (field.value === "boolean" && field.negatable === true)
    return `--${flag} / --no-${flag}`;
  const value = field.value === "boolean" ? "" : ` <${placeholder}>`;
  return `--${flag}${value}`;
};

const renderCommandPath = (value: string, theme: TerminalTheme) =>
  value
    .split(/(<[^>]+>|\[[^\]]+\])/)
    .map((part) => {
      if (part.startsWith("<") && part.endsWith(">"))
        return theme.argument(part);
      if (part.startsWith("[") && part.endsWith("]"))
        return theme.optional(part);
      return part
        .split(/(\s+)/)
        .map((token) => (/^\s+$/.test(token) ? token : theme.command(token)))
        .join("");
    })
    .join("");

const renderSyntax = (value: string, theme: TerminalTheme) => {
  const [executable, ...rest] = value.split(" ");
  return `${theme.executable(executable!)} ${renderCommandPath(rest.join(" "), theme)}`;
};

const renderOption = (value: string, theme: TerminalTheme) => {
  const match = /^(--\S+)(\s+)(<[^>]+>)$/.exec(value);
  return match
    ? `${theme.flag(match[1]!)}${match[2]}${theme.argument(match[3]!)}`
    : theme.flag(value);
};

const width = (context: ComponentRenderContext, group: string) =>
  context.widths[group] ?? 1;

const brandComponent: HelpScreenComponent<HelpViewBlock> = {
  render(_block, context) {
    return context.screen.showWordmark
      ? terminalTheme(context.screen.color).brand(benchPilotWordmark)
      : "";
  },
};

const textComponent: HelpScreenComponent<HelpViewBlock> = {
  render(block, context) {
    const definition = block as Extract<HelpViewBlock, { component: "Text" }>;
    const theme = terminalTheme(context.screen.color);
    const tones = { heading: theme.heading, muted: theme.muted } as const;
    return tones[definition.tone](context.data.summary.text);
  },
};

const descriptionComponent: HelpScreenComponent<HelpViewBlock> = {
  render(_block, context) {
    const description = context.data.description;
    if (!description) return "";
    const theme = terminalTheme(context.screen.color);
    return section(
      theme.heading(t(context.screen.locale, "help.description")),
      [description.text],
    );
  },
};

const usageComponent: HelpScreenComponent<HelpViewBlock> = {
  render(_block, context) {
    const theme = terminalTheme(context.screen.color);
    return section(
      theme.heading(t(context.screen.locale, "help.usage")),
      context.data.usage.map((usage) => renderSyntax(String(usage), theme)),
    );
  },
};

const commandCollectionComponent: HelpScreenComponent<HelpViewBlock> = {
  measure(_block, data) {
    return Math.max(
      1,
      ...data.children.map((child) => displayWidth(commandLabel(child))),
    );
  },
  render(block, context) {
    const definition = block as Extract<
      HelpViewBlock,
      { component: "CommandCollection" }
    >;
    const theme = terminalTheme(context.screen.color);
    const groups = context.data.groups
      .filter((group) => group.views.includes(context.data.view))
      .sort((left, right) => left.order - right.order);
    return groups
      .map((group) => {
        const children = context.data.children
          .filter((child) => child.groupId === group.id)
          .sort((left, right) => (left.order ?? 0) - (right.order ?? 0));
        return section(
          theme.heading(group.label.text),
          children.map(
            (child) =>
              `${theme.command(padExact(commandLabel(child), width(context, definition.widthGroup)))}  ${commandSummary(child)}`,
          ),
        );
      })
      .filter(Boolean)
      .join("\n\n");
  },
};

const childListComponent: HelpScreenComponent<HelpViewBlock> = {
  measure(_block, data) {
    return Math.max(
      1,
      ...data.children.map((child) =>
        displayWidth(child.usage.replace(/^benchpilot\s+/, "")),
      ),
    );
  },
  render(block, context) {
    const definition = block as Extract<
      HelpViewBlock,
      { component: "ChildList" }
    >;
    const theme = terminalTheme(context.screen.color);
    return section(
      theme.heading(t(context.screen.locale, "help.commands")),
      context.data.children.map((child) => {
        const label = child.usage.replace(/^benchpilot\s+/, "");
        return `${theme.command(padExact(label, width(context, definition.widthGroup)))}  ${child.summary.text}`;
      }),
    );
  },
};

const fields = (
  data: HelpData,
  source: "arguments" | "options" | "globalOptions",
) => data[source];

const fieldListComponent: HelpScreenComponent<HelpViewBlock> = {
  measure(block, data) {
    const definition = block as Extract<
      HelpViewBlock,
      { component: "FieldList" }
    >;
    return Math.max(
      1,
      ...fields(data, definition.source).map((field) =>
        displayWidth(fieldName(field)),
      ),
    );
  },
  render(block, context) {
    const definition = block as Extract<
      HelpViewBlock,
      { component: "FieldList" }
    >;
    const theme = terminalTheme(context.screen.color);
    const titles = {
      arguments: () => t(context.screen.locale, "help.arguments"),
      options: () => t(context.screen.locale, "help.options"),
      globalOptions: () => t(context.screen.locale, "help.globalOptions"),
    } as const;
    return section(
      theme.heading(titles[definition.source]()),
      fields(context.data, definition.source).map((field) => {
        const label = fieldName(field);
        const choices = field.choices?.length
          ? ` (${field.choices.join(", ")})`
          : "";
        return `${renderOption(padExact(label, width(context, definition.widthGroup)), theme)}  ${field.summary.text}${choices}`;
      }),
    );
  },
};

const exampleListComponent: HelpScreenComponent<HelpViewBlock> = {
  render(_block, context) {
    const theme = terminalTheme(context.screen.color);
    return section(
      theme.heading(t(context.screen.locale, "help.examples")),
      context.data.examples.map((example) => {
        const command = ["benchpilot", ...example.argv].join(" ");
        const rendered = `${theme.muted("$")} ${renderSyntax(command, theme)}`;
        return example.description
          ? `${rendered}  ${theme.muted(example.description.text)}`
          : rendered;
      }),
    );
  },
};

const errorListComponent: HelpScreenComponent<HelpViewBlock> = {
  render(_block, context) {
    const theme = terminalTheme(context.screen.color);
    return section(
      theme.heading(t(context.screen.locale, "help.errorKinds")),
      context.data.errors.map((error) => theme.error(String(error))),
    );
  },
};

const messageListComponent: HelpScreenComponent<HelpViewBlock> = {
  render(_block, context) {
    const theme = terminalTheme(context.screen.color);
    return context.data.footer
      .map((message) => theme.muted(message.text))
      .join("\n");
  },
};

const safetyComponent: HelpScreenComponent<HelpViewBlock> = {
  render(_block, context) {
    const safety = context.data.safety;
    if (!safety || Array.isArray(safety) || typeof safety !== "object")
      return "";
    const theme = terminalTheme(context.screen.color);
    return section(theme.heading(t(context.screen.locale, "help.safety")), [
      `${theme.muted("mode  ")}${String(safety.mode)}`,
      ...(typeof safety.flag === "string"
        ? [`${theme.muted("flag  ")}--${safety.flag}`]
        : []),
    ]);
  },
};

const outputComponent: HelpScreenComponent<HelpViewBlock> = {
  render(_block, context) {
    const output = context.data.output;
    if (!output || Array.isArray(output) || typeof output !== "object")
      return "";
    const theme = terminalTheme(context.screen.color);
    return section(theme.heading(t(context.screen.locale, "help.output")), [
      `${String(output.schema)} v${String(output.version)}`,
    ]);
  },
};

export const helpScreenComponents: Readonly<
  Record<HelpViewBlock["component"], HelpScreenComponent<HelpViewBlock>>
> = {
  Brand: brandComponent,
  Text: textComponent,
  Description: descriptionComponent,
  UsageList: usageComponent,
  CommandCollection: commandCollectionComponent,
  ChildList: childListComponent,
  FieldList: fieldListComponent,
  ExampleList: exampleListComponent,
  ErrorList: errorListComponent,
  MessageList: messageListComponent,
  SafetyDetail: safetyComponent,
  OutputDetail: outputComponent,
};
