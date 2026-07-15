import type { AdapterDiagnostic, JsonObject } from "./types.js";
import { diagnostic } from "./diagnostics.js";

const namespaces = new Set([
  "adapter",
  "config",
  "device",
  "input",
  "project",
  "tool",
  "discovery",
  "environment",
  "result",
  "step",
  "run",
  "env",
  "platform",
  "home",
  "temp",
]);
const expression = /\$\{([^}]+)\}/g;
const forbidden = new Set(["__proto__", "prototype", "constructor"]);
const schemaFieldExists = (schema: JsonObject, parts: string[]): boolean => {
  if (
    schema.$defs &&
    typeof schema.$defs === "object" &&
    !Array.isArray(schema.$defs)
  )
    return Object.values(schema.$defs as JsonObject).some((definition) =>
      definition && typeof definition === "object" && !Array.isArray(definition)
        ? schemaFieldExists(definition as JsonObject, parts)
        : false,
    );
  let current: JsonObject = schema;
  for (const part of parts) {
    const properties = current.properties;
    if (
      properties &&
      typeof properties === "object" &&
      !Array.isArray(properties)
    ) {
      const next = (properties as JsonObject)[part];
      if (!next || typeof next !== "object" || Array.isArray(next))
        return current.additionalProperties !== false;
      current = next as JsonObject;
    } else return current.additionalProperties !== false;
  }
  return true;
};
export const validateTemplates = (
  value: unknown,
  file: string,
  adapterId: string,
  path = "",
): AdapterDiagnostic[] => {
  const errors: AdapterDiagnostic[] = [];
  if (typeof value === "string")
    for (const match of value.matchAll(expression)) {
      const parts = match[1].split(".");
      if (
        !/^[a-z][a-z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)*$/.test(match[1]) ||
        !namespaces.has(parts[0]) ||
        parts.some((part) => forbidden.has(part))
      )
        errors.push(
          diagnostic(
            "ADAPTER_TEMPLATE_INVALID",
            file,
            `Invalid template variable: ${match[0]}`,
            path,
            adapterId,
          ),
        );
    }
  else if (Array.isArray(value))
    value.forEach((item, index) =>
      errors.push(
        ...validateTemplates(item, file, adapterId, `${path}/${index}`),
      ),
    );
  else if (value && typeof value === "object")
    Object.entries(value as JsonObject).forEach(([key, item]) =>
      errors.push(
        ...validateTemplates(item, file, adapterId, `${path}/${key}`),
      ),
    );
  return errors;
};

export const validateSchemaTemplates = (
  value: unknown,
  file: string,
  adapterId: string,
  schemas: Record<string, JsonObject>,
  path = "",
): AdapterDiagnostic[] => {
  const errors: AdapterDiagnostic[] = [];
  if (typeof value === "string")
    for (const match of value.matchAll(expression)) {
      const [namespace, ...parts] = match[1].split(".");
      const schemaName = namespace === "input" ? "inputs" : namespace;
      if (
        ["config", "device", "input"].includes(namespace) &&
        parts.length &&
        !schemaFieldExists(schemas[schemaName] ?? {}, parts)
      )
        errors.push(
          diagnostic(
            "ADAPTER_TEMPLATE_INVALID",
            file,
            `Template field cannot exist in the ${namespace} schema: ${match[0]}`,
            path,
            adapterId,
          ),
        );
    }
  else if (Array.isArray(value))
    value.forEach((item, index) =>
      errors.push(
        ...validateSchemaTemplates(
          item,
          file,
          adapterId,
          schemas,
          `${path}/${index}`,
        ),
      ),
    );
  else if (value && typeof value === "object")
    Object.entries(value as JsonObject).forEach(([key, item]) =>
      errors.push(
        ...validateSchemaTemplates(
          item,
          file,
          adapterId,
          schemas,
          `${path}/${key}`,
        ),
      ),
    );
  return errors;
};
