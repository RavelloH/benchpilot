export type JsonObject = { [key: string]: unknown };

export interface AdapterDiagnostic {
  severity: "error" | "warning";
  code: string;
  adapterId?: string;
  file: string;
  path?: string;
  message: string;
  details?: unknown;
}

export interface LoadedAdapter {
  id: string;
  root: string;
  files: Record<string, JsonObject>;
  schemas: Record<string, JsonObject>;
}

export interface CompiledAdapterBundleV1 {
  schema: "benchpilot.adapter-bundle";
  schemaVersion: 1;
  id: string;
  sourceHash: string;
  manifest: JsonObject;
  capabilityCatalog: JsonObject;
  schemas: Record<string, JsonObject>;
  platforms: Record<string, JsonObject>;
}
