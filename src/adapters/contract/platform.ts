import type { JsonObject } from "./bundle.js";

const object = (value: unknown): value is JsonObject =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

/** Deterministic platform overlay merge: objects merge recursively, arrays replace. */
export const mergePlatform = (
  base: JsonObject,
  overlay: JsonObject,
): JsonObject => {
  const result: JsonObject = { ...base };
  for (const [key, value] of Object.entries(overlay))
    result[key] =
      object(value) && object(base[key])
        ? mergePlatform(base[key] as JsonObject, value)
        : value;
  return result;
};
