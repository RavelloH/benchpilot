import type { Json } from "../core.js";

export interface RawOption {
  name: string;
  value?: string;
  negated?: boolean;
}

interface CapabilityOption {
  name: string;
  schema?: { describe(): Json };
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
): Json {
  const schemas = new Map(
    definitions.map((definition) => [definition.name, definition.schema]),
  );
  return Object.fromEntries(
    options
      .filter((option) => option.name !== safetyFlag)
      .map((option) => {
        if (option.negated) return [option.name, false];
        if (option.value === undefined) return [option.name, true];
        const schema = schemas.get(option.name)?.describe();
        if (schema?.type === "boolean") {
          if (option.value === "true") return [option.name, true];
          if (option.value === "false") return [option.name, false];
        }
        if (schema?.type === "number" && /^-?\d+(?:\.\d+)?$/.test(option.value))
          return [option.name, Number(option.value)];
        return [option.name, option.value];
      }),
  );
}
