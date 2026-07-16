import type { Json } from "../core.js";

export interface RawOption {
  name: string;
  value?: string;
  negated?: boolean;
}

interface CapabilityOption {
  name: string;
  schema?: { describe(): Json };
  aliases?: string[];
  positional?: number;
  repeatable?: boolean;
}

/** Converts options only after a non-capability command has been selected. */
export function commandOptionFlags(options: RawOption[]): Json {
  return Object.fromEntries(
    options.map((option) => [
      option.name,
      option.negated
        ? false
        : option.value === undefined
          ? true
          : option.value === "true"
            ? true
            : option.value === "false"
              ? false
              : option.value,
    ]),
  );
}

export function optionEnabled(options: RawOption[], name: string | undefined) {
  if (!name) return false;
  const option = [...options]
    .reverse()
    .find((candidate) => candidate.name === name);
  if (!option || option.negated) return false;
  return option.value !== "false";
}

/**
 * Converts raw values using the selected Capability's schema descriptions.
 * Unknown options deliberately remain in the input for OperationRunner to
 * report as INVALID_CAPABILITY_INPUT with the capability context.
 */
export function capabilityInput(
  options: RawOption[],
  definitions: CapabilityOption[],
  safetyFlag?: string,
  positional: string[] = [],
): Json {
  const aliases = new Map(
    definitions.flatMap((definition) =>
      (definition.aliases ?? []).map((alias) => [
        alias.replace(/^--?/, ""),
        definition.name,
      ]),
    ),
  );
  const schemas = new Map(
    definitions.map((definition) => [definition.name, definition.schema]),
  );
  const entries = options
    .filter((option) => option.name !== safetyFlag)
    .map((option) => {
      const name = aliases.get(option.name) ?? option.name;
      if (option.negated) return [name, false] as const;
      if (option.value === undefined) return [name, true] as const;
      const schema = schemas.get(name)?.describe();
      if (schema?.type === "boolean") {
        if (option.value === "true") return [name, true] as const;
        if (option.value === "false") return [name, false] as const;
      }
      if (schema?.type === "number" && /^-?\d+(?:\.\d+)?$/.test(option.value))
        return [name, Number(option.value)] as const;
      if (schema?.type === "integer" && /^-?\d+$/.test(option.value))
        return [name, Number(option.value)] as const;
      return [name, option.value] as const;
    });
  for (const option of definitions)
    if (
      option.positional !== undefined &&
      positional[option.positional] !== undefined
    )
      entries.push([option.name, positional[option.positional]]);
  const result: Json = {};
  for (const [name, value] of entries) {
    const definition = definitions.find((item) => item.name === name);
    if (definition?.repeatable) {
      const values = Array.isArray(result[name]) ? result[name] : [];
      result[name] = [...values, value];
    } else result[name] = value;
  }
  return result;
}
