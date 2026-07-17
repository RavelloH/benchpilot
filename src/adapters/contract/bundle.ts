import { sha } from "../../core/utilities/stable-json.js";

export type JsonObject = { [key: string]: unknown };

export interface CompiledAdapterBundleV2 {
  schema: "benchpilot.adapter-bundle";
  schemaVersion: 2;
  id: string;
  sourceHash: string;
  bundleSha256: string;
  capabilityCatalogVersion: 1;
  capabilityCatalogHash: string;
  manifest: JsonObject;
  capabilityCatalog: JsonObject;
  schemas: Record<string, JsonObject>;
  platforms: Record<string, JsonObject>;
}

export type UnsignedAdapterBundleV2 = Omit<
  CompiledAdapterBundleV2,
  "bundleSha256"
>;

/** Hash canonical bundle content, excluding its self-referential digest. */
export const bundleSha256 = (
  bundle: UnsignedAdapterBundleV2 | CompiledAdapterBundleV2,
) => {
  const content = { ...bundle } as Record<string, unknown>;
  delete content.bundleSha256;
  return sha(content);
};
