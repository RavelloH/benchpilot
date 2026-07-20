import type { JsonObject, JsonValue } from "../../contracts/json.js";
import type {
  CommandDefinition,
  CommandFieldDefinition,
  DynamicCommandProvider,
} from "./definition.js";
import type { CommandIntent } from "./contracts.js";
import {
  CommandResolutionError,
  CommandResolver,
  type ResolvedCommand,
} from "./resolver.js";

export type CommandParseErrorCode =
  | "UNKNOWN_OPTION"
  | "MISSING_OPTION_VALUE"
  | "DUPLICATE_OPTION"
  | "INVALID_OPTION_VALUE"
  | "OPTION_CONFLICT";

export class CommandParseError extends Error {
  constructor(
    readonly code: CommandParseErrorCode,
    readonly details: Readonly<Record<string, unknown>> = {},
  ) {
    super(`${code}: ${JSON.stringify(details)}`);
    this.name = "CommandParseError";
  }
}

interface RawOption {
  readonly name: string;
  readonly value?: string;
  readonly negated: boolean;
}

export interface ParsedCommand {
  readonly resolved: ResolvedCommand;
  readonly intent: CommandIntent;
  readonly missingFields: readonly string[];
}

const optionNames = (field: CommandFieldDefinition) => [
  field.name,
  ...(field.aliases ?? []),
];

const knownOptions = (
  definitions: readonly CommandDefinition[],
  globals: readonly CommandFieldDefinition[],
) => {
  const fields = [...globals, ...definitions.flatMap((item) => item.options)];
  const result = new Map<string, CommandFieldDefinition>();
  for (const field of fields)
    for (const name of optionNames(field)) {
      const current = result.get(name);
      if (!current || current.value === field.value) result.set(name, field);
    }
  return result;
};

const tokenize = (
  argv: readonly string[],
  known: ReadonlyMap<string, CommandFieldDefinition>,
) => {
  const positional: string[] = [];
  const options: RawOption[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]!;
    if (token === "--") {
      positional.push(...argv.slice(index + 1));
      break;
    }
    if (!token.startsWith("-") || token === "-") {
      positional.push(token);
      continue;
    }
    const long = token.startsWith("--");
    const body = token.slice(long ? 2 : 1);
    const [rawName, inline] = body.split("=", 2);
    const negated = long && rawName.startsWith("no-");
    const name = negated ? rawName.slice(3) : rawName;
    const field = known.get(name);
    let value = inline;
    const expectsValue = field ? field.value !== "boolean" : true;
    if (value === undefined && expectsValue) {
      const next = argv[index + 1];
      if (next !== undefined && (!next.startsWith("-") || next === "-"))
        value = argv[++index]!;
    }
    options.push({ name, ...(value === undefined ? {} : { value }), negated });
  }
  return { positional, options };
};

const parseBoolean = (raw: RawOption) => {
  if (raw.value === undefined) return !raw.negated;
  if (raw.negated)
    throw new CommandParseError("INVALID_OPTION_VALUE", {
      option: raw.name,
      reason: "negated option cannot also have a value",
    });
  if (raw.value === "true") return true;
  if (raw.value === "false") return false;
  throw new CommandParseError("INVALID_OPTION_VALUE", {
    option: raw.name,
    value: raw.value,
  });
};

const parseValue = (
  field: CommandFieldDefinition,
  raw: RawOption,
): JsonValue => {
  if (field.value === "boolean") return parseBoolean(raw);
  if (raw.negated)
    throw new CommandParseError("INVALID_OPTION_VALUE", {
      option: raw.name,
      reason: "only boolean options may be negated",
    });
  if (raw.value === undefined)
    throw new CommandParseError("MISSING_OPTION_VALUE", { option: raw.name });
  if (field.value !== "json") return raw.value;
  try {
    return JSON.parse(raw.value) as JsonValue;
  } catch {
    throw new CommandParseError("INVALID_OPTION_VALUE", {
      option: raw.name,
      value: raw.value,
    });
  }
};

export class CommandArgvParser {
  private readonly resolver: CommandResolver;
  private readonly known: ReadonlyMap<string, CommandFieldDefinition>;

  constructor(
    private readonly definitions: readonly CommandDefinition[],
    private readonly globalOptions: readonly CommandFieldDefinition[],
    provider: DynamicCommandProvider,
  ) {
    this.resolver = new CommandResolver(definitions, provider);
    this.known = knownOptions(definitions, globalOptions);
  }

  async parse(argv: readonly string[]): Promise<ParsedCommand> {
    const tokenized = tokenize(argv, this.known);
    const version = tokenized.options.some(
      (option) => option.name === "version" && !option.negated,
    );
    const path =
      !tokenized.positional.length && version
        ? ["version"]
        : tokenized.positional;
    let resolved: ResolvedCommand;
    try {
      resolved = await this.resolver.resolve(path, {
        allowIncompleteArguments: true,
      });
    } catch (error) {
      if (error instanceof CommandResolutionError) throw error;
      throw error;
    }
    const fields = [...this.globalOptions, ...resolved.definition.options];
    const byName = new Map<string, CommandFieldDefinition>();
    for (const field of fields)
      for (const name of optionNames(field)) byName.set(name, field);
    const globalNames = new Set(
      this.globalOptions.flatMap((field) => optionNames(field)),
    );
    const values = new Map<string, JsonValue | JsonValue[]>();
    for (const raw of tokenized.options) {
      const field = byName.get(raw.name);
      if (!field)
        throw new CommandParseError("UNKNOWN_OPTION", { option: raw.name });
      if (raw.negated && !field.negatable)
        throw new CommandParseError("INVALID_OPTION_VALUE", {
          option: raw.name,
          reason: "option is not negatable",
        });
      const value = parseValue(field, raw);
      const current = values.get(field.name);
      if (current !== undefined && !field.repeatable)
        throw new CommandParseError("DUPLICATE_OPTION", {
          option: field.name,
        });
      values.set(
        field.name,
        field.repeatable
          ? [...(Array.isArray(current) ? current : []), value]
          : value,
      );
    }
    const globals: Record<string, JsonValue> = {};
    const options: Record<string, JsonValue> = {};
    for (const [name, value] of values)
      (globalNames.has(name) ? globals : options)[name] = value;
    if (globals.json === true && globals.jsonl === true)
      throw new CommandParseError("OPTION_CONFLICT", {
        options: ["json", "jsonl"],
      });
    const selectedScopes = ["local", "project", "global"].filter(
      (name) => options[name] === true,
    );
    if (selectedScopes.length > 1)
      throw new CommandParseError("OPTION_CONFLICT", {
        options: selectedScopes,
      });
    const input: Record<string, JsonValue> = Object.fromEntries(
      Object.entries(resolved.captures).map(([name, value]) => [
        name,
        typeof value === "string" ? value : [...value],
      ]),
    );
    const missingFields = [
      ...resolved.definition.arguments
        .filter(
          (field) =>
            field.required &&
            (input[field.name] === undefined ||
              (Array.isArray(input[field.name]) &&
                (input[field.name] as JsonValue[]).length === 0)),
        )
        .map((field) => field.name),
      ...resolved.definition.options
        .filter((field) => field.required && options[field.name] === undefined)
        .map((field) => field.name),
    ];
    return {
      resolved,
      intent: {
        commandId: resolved.definition.id,
        ...(resolved.definition.handler
          ? { handlerId: resolved.definition.handler }
          : {}),
        path: [...path],
        input,
        options,
        globals,
      },
      missingFields,
    };
  }
}
