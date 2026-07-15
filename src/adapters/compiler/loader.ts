import { readFile } from "node:fs/promises";
import { resolve, basename } from "node:path";
import { parse } from "@iarna/toml";
import { fixedFiles } from "./layout.js";
import type { JsonObject, LoadedAdapter } from "./types.js";

const object = (value: unknown): JsonObject =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
const jsonFiles = new Set([
  "schemas/config.schema.json",
  "schemas/device.schema.json",
  "schemas/inputs.schema.json",
  "schemas/outputs.schema.json",
]);
export const loadAdapter = async (root: string): Promise<LoadedAdapter> => {
  const files: Record<string, JsonObject> = {};
  const schemas: Record<string, JsonObject> = {};
  for (const file of fixedFiles.filter((item) => item !== "README.md")) {
    const text = await readFile(resolve(root, file), "utf8");
    const value = object(jsonFiles.has(file) ? JSON.parse(text) : parse(text));
    if (jsonFiles.has(file)) schemas[basename(file, ".schema.json")] = value;
    else files[file] = value;
  }
  const directoryId = basename(root);
  return {
    id: directoryId === "_template" ? "template" : directoryId,
    root,
    files,
    schemas,
  };
};
