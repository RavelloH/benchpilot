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
