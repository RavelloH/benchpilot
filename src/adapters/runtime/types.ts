import type { CompiledAdapterBundleV1, JsonObject } from "../compiler/types.js";

export type RuntimePlatform = "windows" | "linux" | "macos";

export interface CompiledAdapterIndexEntry {
  id: string;
  displayName: string;
  adapterVersion: string;
  status: string;
  sourceHash: string;
  path: string;
  platforms: Record<string, Record<string, boolean>>;
}

export type CompiledAdapterIndex = CompiledAdapterIndexEntry[];

export interface RuntimeAdapter {
  readonly bundle: Readonly<CompiledAdapterBundleV1>;
  readonly platform: RuntimePlatform;
  readonly rules: Readonly<JsonObject>;
}

export interface AdapterRuntimeContext {
  adapter: RuntimeAdapter;
  config: JsonObject;
  device: JsonObject;
  input: JsonObject;
  project: JsonObject;
  platform: RuntimePlatform;
  home: string;
  temp: string;
  env: NodeJS.ProcessEnv;
  run?: { dir: string; id: string };
  tool: Record<string, JsonObject>;
  discovery: Record<string, JsonObject>;
  environment: Record<string, NodeJS.ProcessEnv>;
  result: JsonObject;
  step?: JsonObject;
}
