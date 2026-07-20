import type { MessageRef } from "../../contracts/message-ref.js";
import type { Safety } from "../../core.js";
import type {
  CommandCatalogDefinition,
  CommandDefinition,
  CommandExample,
  CommandFieldDefinition,
  CommandOutputReference,
  DynamicCommandProvider,
  DynamicCommandValue,
} from "./definition.js";
import { CommandResolver, type ResolvedCommand } from "./resolver.js";

export interface HelpCommandEntry {
  readonly id: string;
  readonly path: readonly string[];
  readonly usage: string;
  readonly summary: MessageRef;
  readonly navigationSummary?: MessageRef;
  readonly group?: MessageRef;
  readonly groupId?: string;
  readonly order?: number;
  readonly availability: "available" | "unavailable";
}

export interface HelpCommandGroup {
  readonly id: string;
  readonly label: MessageRef;
  readonly order: number;
  readonly views: readonly string[];
}

export interface HelpDocument {
  readonly schema: "benchpilot.help";
  readonly version: 3;
  readonly command: {
    readonly id: string;
    readonly path: readonly string[];
    readonly executable: boolean;
    readonly handler?: string;
  };
  readonly view: string;
  readonly interactionView?: string;
  readonly usage: readonly string[];
  readonly summary: MessageRef;
  readonly description?: MessageRef;
  readonly arguments: readonly CommandFieldDefinition[];
  readonly options: readonly CommandFieldDefinition[];
  readonly globalOptions: readonly CommandFieldDefinition[];
  readonly groups: readonly HelpCommandGroup[];
  readonly children: readonly HelpCommandEntry[];
  readonly examples: readonly CommandExample[];
  readonly footer: readonly MessageRef[];
  readonly output?: CommandOutputReference;
  readonly safety?: Safety;
  readonly errors: readonly string[];
}

const fieldForSegment = (definition: CommandDefinition, name: string) =>
  definition.arguments.find((field) => field.name === name);

const syntax = (
  definition: CommandDefinition,
  replacements: Readonly<Record<string, string>> = {},
) =>
  definition.path
    .map((segment) => {
      if (segment.kind === "literal") return segment.value;
      const replacement = replacements[segment.name];
      if (replacement) return replacement;
      const field = fieldForSegment(definition, segment.name);
      const value = `<${segment.name}${field?.variadic ? "..." : ""}>`;
      return segment.kind !== "argument" || field?.required
        ? value
        : `[${value}]`;
    })
    .join(" ");

const childEntry = (
  definition: CommandDefinition,
  replacements: Readonly<Record<string, string>> = {},
  dynamic?: DynamicCommandValue,
): HelpCommandEntry => ({
  id: definition.id,
  path: definition.path.map((segment) =>
    segment.kind === "literal"
      ? segment.value
      : (replacements[segment.name] ?? `<${segment.name}>`),
  ),
  usage: `benchpilot ${syntax(definition, replacements)}`,
  summary: dynamic?.summary ?? definition.summary,
  ...(definition.navigation
    ? { navigationSummary: definition.navigation.summary }
    : {}),
  ...(definition.group ? { group: definition.group } : {}),
  ...(definition.navigation
    ? {
        groupId: definition.navigation.groupId,
        order: definition.navigation.order,
      }
    : {}),
  availability: dynamic?.availability ?? definition.availability ?? "available",
});

/** Read-only projection of the command graph for help and completion. */
export class HelpDocumentService {
  private readonly resolver: CommandResolver;

  constructor(
    private readonly catalog: CommandCatalogDefinition,
    private readonly provider: DynamicCommandProvider,
  ) {
    this.resolver = new CommandResolver(catalog.commands, provider);
  }

  async document(
    path: readonly string[],
    options: { includeDynamicValues?: boolean } = {},
  ): Promise<HelpDocument> {
    if (!path.length) return this.rootDocument(options.includeDynamicValues);
    const resolved = await this.resolver.resolve(path, {
      allowIncompleteArguments: true,
    });
    const children = await this.children(
      resolved,
      options.includeDynamicValues,
    );
    const definition = resolved.definition;
    return {
      schema: "benchpilot.help",
      version: 3,
      command: {
        id: definition.id,
        path: [...path],
        executable: resolved.executable,
        ...(definition.handler ? { handler: definition.handler } : {}),
      },
      view: definition.helpView ?? this.catalog.commandHelpView,
      usage: [`benchpilot ${syntax(definition, this.replacements(resolved))}`],
      summary: definition.summary,
      ...(definition.description
        ? { description: definition.description }
        : {}),
      arguments: definition.arguments,
      options: definition.options,
      globalOptions: this.catalog.globalOptions,
      groups: [],
      children,
      examples: definition.examples ?? [],
      footer: [],
      ...(definition.output ? { output: definition.output } : {}),
      ...(definition.safety ? { safety: definition.safety } : {}),
      errors: definition.errors ?? [],
    };
  }

  private rootDocument(includeAll = false): HelpDocument {
    const root = this.catalog.root;
    const roots = includeAll
      ? this.catalog.commands
      : this.catalog.commands.filter((definition) => !definition.parentId);
    const globalOptions = root.globalOptions.flatMap((option) => {
      const field = this.catalog.globalOptions.find(
        (candidate) => candidate.name === option.name,
      );
      return field ? [{ ...field, summary: option.summary }] : [];
    });
    return {
      schema: "benchpilot.help",
      version: 3,
      command: { id: root.id, path: [], executable: false },
      view: includeAll ? root.allHelpView : root.helpView,
      interactionView: root.interactionView,
      usage: root.usage,
      summary: root.summary,
      arguments: [],
      options: [],
      globalOptions,
      groups: this.catalog.groups,
      children: roots.map((definition) => childEntry(definition)),
      examples: root.examples,
      footer: root.footer,
      errors: [],
    };
  }

  private replacements(resolved: ResolvedCommand) {
    return Object.fromEntries(
      Object.entries(resolved.captures).flatMap(([name, value]) =>
        typeof value === "string" ? [[name, value]] : [],
      ),
    );
  }

  private async children(
    resolved: ResolvedCommand,
    includeDynamicValues = false,
  ): Promise<HelpCommandEntry[]> {
    const definitions = this.catalog.commands.filter(
      (definition) => definition.parentId === resolved.definition.id,
    );
    const replacements = this.replacements(resolved);
    const entries: HelpCommandEntry[] = [];
    for (const definition of definitions) {
      const next = definition.path[resolved.definition.path.length];
      if (
        next &&
        next.kind !== "literal" &&
        next.kind !== "argument" &&
        includeDynamicValues
      ) {
        const values = await this.provider.values({
          provider: next.provider,
          captures: resolved.captures,
          definition,
        });
        entries.push(
          ...values.map((value) =>
            childEntry(
              definition,
              { ...replacements, [next.name]: value.value },
              value,
            ),
          ),
        );
      } else entries.push(childEntry(definition, replacements));
    }
    return entries.sort((left, right) => left.usage.localeCompare(right.usage));
  }
}
