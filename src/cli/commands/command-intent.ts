import type { CommandFieldDefinition } from "../../application/commands/definition.js";
import type { CommandIntent } from "../../application/commands/contracts.js";
import type { ParsedCommand } from "../../application/commands/parser.js";
import type { CommandArgvParser } from "../../application/commands/parser.js";
import type { CommandResolver } from "../../application/commands/resolver.js";

interface CommandGraphParser {
  readonly parser: CommandArgvParser;
  readonly resolver: CommandResolver;
  readonly globalOptions: readonly CommandFieldDefinition[];
}

const optionArgv = (
  field: CommandFieldDefinition,
  value: unknown,
): string[] => {
  const name = `--${field.name}`;
  if (field.repeatable && Array.isArray(value))
    return value.flatMap((item) =>
      optionArgv({ ...field, repeatable: false }, item),
    );
  if (field.value === "boolean") {
    if (value === true) return [name];
    if (value === false)
      return field.negatable ? [`--no-${field.name}`] : [`${name}=false`];
  }
  return [name, field.value === "json" ? JSON.stringify(value) : String(value)];
};

/** Re-parses an interactive draft through the same argv contract as direct calls. */
export async function parseCommandState(input: {
  readonly graph: CommandGraphParser;
  readonly path: readonly string[];
  readonly values: Readonly<Record<string, unknown>>;
}): Promise<ParsedCommand> {
  const resolved = await input.graph.resolver.resolve(input.path, {
    allowIncompleteArguments: true,
  });
  const fields = [...input.graph.globalOptions, ...resolved.definition.options];
  const options = fields.flatMap((field) => {
    const value =
      input.values[field.name] ??
      field.aliases
        ?.map((alias) => input.values[alias])
        .find((item) => item !== undefined);
    return value === undefined ? [] : optionArgv(field, value);
  });
  return input.graph.parser.parse([...input.path, ...options]);
}

export const commandIntentValues = (intent: CommandIntent) => ({
  ...intent.globals,
  ...intent.options,
});
