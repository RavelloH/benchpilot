import Ajv2020Import from "ajv/dist/2020.js";
import addFormatsImport from "ajv-formats";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { AdapterDiagnostic, JsonObject, LoadedAdapter } from "./types.js";
import { diagnostic } from "./diagnostics.js";

const schemaFor: Record<string, string> = {
  "manifest.toml": "manifest",
  "capabilities.toml": "capabilities",
  "tools.toml": "tools",
  "tool-discovery.toml": "tool-discovery",
  "environments.toml": "environments",
  "devices.toml": "devices",
  "actions.toml": "actions",
  "workflows.toml": "workflows",
  "parsers.toml": "parsers",
  "artifacts.toml": "artifacts",
  "tests/cases.toml": "cases",
  "platforms/windows.toml": "platform",
  "platforms/linux.toml": "platform",
  "platforms/macos.toml": "platform",
};

type Validator = {
  (data: unknown): boolean;
  errors?: { message?: string; instancePath: string }[];
};
type Ajv = {
  compile(schema: unknown): Validator;
  validateSchema(schema: unknown): boolean;
  errors?: { message?: string; instancePath: string }[];
};
const createAjv = (): Ajv => {
  const Ajv2020 = Ajv2020Import as unknown as new (options: unknown) => Ajv;
  const addFormats = addFormatsImport as unknown as (instance: Ajv) => void;
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  return ajv;
};
const schemaError = (
  diagnostics: AdapterDiagnostic[],
  adapter: LoadedAdapter,
  file: string,
  message: string,
  path?: string,
) =>
  diagnostics.push(
    diagnostic("ADAPTER_SCHEMA_INVALID", file, message, path, adapter.id),
  );
const forbidden = new Set(["__proto__", "prototype", "constructor"]);
const validateSchemaExtensions = (
  value: unknown,
  adapter: LoadedAdapter,
  file: string,
  diagnostics: AdapterDiagnostic[],
  path = "",
) => {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value))
    return value.forEach((item, index) =>
      validateSchemaExtensions(
        item,
        adapter,
        file,
        diagnostics,
        `${path}/${index}`,
      ),
    );
  for (const [key, child] of Object.entries(value as JsonObject)) {
    if (
      (key === "properties" || key === "$defs") &&
      child &&
      typeof child === "object" &&
      !Array.isArray(child)
    )
      for (const property of Object.keys(child as JsonObject))
        if (forbidden.has(property))
          schemaError(
            diagnostics,
            adapter,
            file,
            `Dangerous schema property: ${property}`,
            `${path}/${key}/${property}`,
          );
    if (key === "x-benchpilot-cli") {
      const extension = child as JsonObject;
      const allowed = new Set([
        "flag",
        "aliases",
        "positional",
        "secret",
        "repeatable",
        "hidden",
      ]);
      const invalid =
        !extension ||
        typeof extension !== "object" ||
        Array.isArray(extension) ||
        Object.keys(extension).some((name) => !allowed.has(name)) ||
        (extension.flag !== undefined && typeof extension.flag !== "string") ||
        (extension.aliases !== undefined &&
          (!Array.isArray(extension.aliases) ||
            extension.aliases.some((item) => typeof item !== "string")));
      if (invalid)
        schemaError(
          diagnostics,
          adapter,
          file,
          "Invalid x-benchpilot-cli extension",
          `${path}/${key}`,
        );
    }
    validateSchemaExtensions(
      child,
      adapter,
      file,
      diagnostics,
      `${path}/${key}`,
    );
  }
};

export const validateSchemas = async (
  adapter: LoadedAdapter,
  schemaRoot: string,
): Promise<AdapterDiagnostic[]> => {
  const ajv = createAjv();
  const diagnostics: AdapterDiagnostic[] = [];
  for (const [file, kind] of Object.entries(schemaFor)) {
    const schema = JSON.parse(
      await readFile(resolve(schemaRoot, `${kind}.schema.json`), "utf8"),
    ) as JsonObject;
    const validate = ajv.compile(schema);
    if (!validate(adapter.files[file]))
      for (const error of validate.errors ?? [])
        diagnostics.push(
          diagnostic(
            "ADAPTER_SCHEMA_INVALID",
            file,
            error.message ?? "Schema validation failed",
            error.instancePath,
            adapter.id,
          ),
        );
  }
  for (const [name, schema] of Object.entries(adapter.schemas)) {
    const file = `schemas/${name}.schema.json`;
    if (schema.$schema !== "https://json-schema.org/draft/2020-12/schema")
      schemaError(
        diagnostics,
        adapter,
        file,
        "Schema must use JSON Schema Draft 2020-12",
      );
    if (schema.type !== "object")
      schemaError(
        diagnostics,
        adapter,
        file,
        "Schema root type must be object",
      );
    if (
      (name === "inputs" || name === "outputs") &&
      (!schema.$defs ||
        typeof schema.$defs !== "object" ||
        Array.isArray(schema.$defs))
    )
      schemaError(
        diagnostics,
        adapter,
        file,
        "Input and output schemas require $defs",
      );
    if (!ajv.validateSchema(schema))
      for (const error of ajv.errors ?? [])
        schemaError(
          diagnostics,
          adapter,
          file,
          error.message ?? "Invalid JSON Schema",
          error.instancePath,
        );
    try {
      ajv.compile(schema);
    } catch (error) {
      schemaError(
        diagnostics,
        adapter,
        file,
        `Schema cannot compile: ${(error as Error).message}`,
      );
    }
    if (
      (name === "inputs" || name === "outputs") &&
      schema.$defs &&
      typeof schema.$defs === "object"
    )
      for (const [definition, value] of Object.entries(
        schema.$defs as JsonObject,
      ))
        try {
          ajv.compile(value);
        } catch (error) {
          schemaError(
            diagnostics,
            adapter,
            file,
            `$defs.${definition} cannot compile: ${(error as Error).message}`,
          );
        }
    validateSchemaExtensions(schema, adapter, file, diagnostics);
  }
  return diagnostics;
};

export const validateBundle = async (
  bundle: JsonObject,
  schemaRoot: string,
  adapterId: string,
) => {
  const ajv = createAjv();
  const schema = JSON.parse(
    await readFile(resolve(schemaRoot, "bundle.schema.json"), "utf8"),
  );
  const validate = ajv.compile(schema);
  if (validate(bundle)) return [] as AdapterDiagnostic[];
  return (validate.errors ?? []).map((error) =>
    diagnostic(
      "ADAPTER_BUNDLE_INVALID",
      "bundle.schema.json",
      error.message ?? "Bundle schema validation failed",
      error.instancePath,
      adapterId,
    ),
  );
};
