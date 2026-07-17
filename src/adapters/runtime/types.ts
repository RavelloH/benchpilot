import type {
  CompiledAdapterBundleV2,
  JsonObject,
} from "../contract/bundle.js";

export type RuntimePlatform = "windows" | "linux" | "macos";

export interface CompiledAdapterIndexEntry {
  id: string;
  displayName: string;
  adapterVersion: string;
  status: string;
  sourceHash: string;
  bundleSha256: string;
  path: string;
  platforms: Record<string, Record<string, boolean>>;
}

export type CompiledAdapterIndex = CompiledAdapterIndexEntry[];

export interface RuntimeAdapter {
  readonly bundle: Readonly<CompiledAdapterBundleV2>;
  readonly platform: RuntimePlatform;
  readonly rules: Readonly<JsonObject>;
}

export interface AdapterRuntimeContext {
  adapter: {
    id: string;
    version: string;
    manifest: JsonObject;
  };
  config: JsonObject;
  device: JsonObject;
  input: JsonObject;
  project: { root: string };
  platform: RuntimePlatform;
  home: string;
  temp: string;
  env: NodeJS.ProcessEnv;
  run?: { dir: string; id: string };
  tool: Record<string, JsonObject>;
  discovery: Record<string, JsonObject>;
  environment: Record<string, JsonObject>;
  result: JsonObject;
  step?: JsonObject;
}
