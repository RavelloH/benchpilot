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

export const validateSchemas = async (
  adapter: LoadedAdapter,
  schemaRoot: string,
): Promise<AdapterDiagnostic[]> => {
  const Ajv2020 = Ajv2020Import as unknown as new (options: unknown) => {
    compile(schema: unknown): {
      (data: unknown): boolean;
      errors?: { message?: string; instancePath: string }[];
    };
  };
  const addFormats = addFormatsImport as unknown as (instance: unknown) => void;
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
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
    const validate = ajv.compile({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
    });
    if (!validate(schema))
      diagnostics.push(
        diagnostic(
          "ADAPTER_SCHEMA_INVALID",
          `schemas/${name}.schema.json`,
          "Invalid JSON Schema",
          undefined,
          adapter.id,
        ),
      );
  }
  return diagnostics;
};
