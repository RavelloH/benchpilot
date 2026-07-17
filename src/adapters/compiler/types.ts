export type {
  JsonObject,
  CompiledAdapterBundleV2,
} from "../contract/bundle.js";
import type { JsonObject } from "../contract/bundle.js";

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

export type { CompiledAdapterBundleV2 as CompiledAdapterBundleV1 } from "../contract/bundle.js";
