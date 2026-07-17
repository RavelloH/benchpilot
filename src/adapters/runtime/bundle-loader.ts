import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  bundleSha256,
  type CompiledAdapterBundleV2,
} from "../contract/bundle.js";
import { AdapterRuntimeError } from "./errors.js";
import type { CompiledAdapterIndex, RuntimePlatform } from "./types.js";

const adapterId = /^[a-z][a-z0-9-]*$/;
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const deepFreeze = <T>(value: T): T => {
  if (!value || typeof value !== "object" || Object.isFrozen(value))
    return value;
  Object.freeze(value);
  for (const child of Object.values(value as object)) deepFreeze(child);
  return value;
};

export class AdapterBundleLoader {
  private index?: Readonly<CompiledAdapterIndex>;
  private bundles = new Map<string, Readonly<CompiledAdapterBundleV2>>();

  constructor(
    private readonly root = new URL("../bundles/", import.meta.url),
  ) {}

  async loadIndex(): Promise<Readonly<CompiledAdapterIndex>> {
    if (this.index) return this.index;
    let raw: unknown;
    try {
      raw = JSON.parse(
        await readFile(fileURLToPath(new URL("index.json", this.root)), "utf8"),
      );
    } catch (error) {
      throw new AdapterRuntimeError(
        "ADAPTER_INDEX_INVALID",
        `Could not load adapter index: ${(error as Error).message}`,
      );
    }
    if (
      !Array.isArray(raw) ||
      raw.some((entry) => {
        const value = object(entry);
        return (
          !adapterId.test(String(value.id)) ||
          typeof value.path !== "string" ||
          typeof value.sourceHash !== "string" ||
          typeof value.bundleSha256 !== "string"
        );
      })
    )
      throw new AdapterRuntimeError(
        "ADAPTER_INDEX_INVALID",
        "Adapter index has an invalid entry.",
      );
    this.index = deepFreeze(raw as CompiledAdapterIndex);
    return this.index;
  }

  async load(id: string): Promise<Readonly<CompiledAdapterBundleV2>> {
    if (!adapterId.test(id))
      throw new AdapterRuntimeError(
        "ADAPTER_NOT_FOUND",
        `Invalid adapter id: ${id}`,
      );
    const cached = this.bundles.get(id);
    if (cached) return cached;
    const entry = (await this.loadIndex()).find((item) => item.id === id);
    if (!entry)
      throw new AdapterRuntimeError(
        "ADAPTER_NOT_FOUND",
        `Adapter not found: ${id}`,
      );
    if (entry.path !== `${id}.json`)
      throw new AdapterRuntimeError(
        "ADAPTER_INDEX_INVALID",
        `Adapter index path is invalid for ${id}.`,
      );
    let bundle: CompiledAdapterBundleV2;
    try {
      bundle = JSON.parse(
        await readFile(fileURLToPath(new URL(entry.path, this.root)), "utf8"),
      ) as CompiledAdapterBundleV2;
    } catch (error) {
      throw new AdapterRuntimeError(
        "ADAPTER_BUNDLE_INVALID",
        `Could not load adapter bundle ${id}: ${(error as Error).message}`,
      );
    }
    if (
      bundle.schema !== "benchpilot.adapter-bundle" ||
      bundle.schemaVersion !== 2 ||
      bundle.id !== id
    )
      throw new AdapterRuntimeError(
        "ADAPTER_BUNDLE_INVALID",
        `Adapter bundle is invalid: ${id}`,
      );
    if (bundle.sourceHash !== entry.sourceHash)
      throw new AdapterRuntimeError(
        "ADAPTER_BUNDLE_HASH_MISMATCH",
        `Adapter bundle hash does not match its index: ${id}`,
      );
    if (
      bundle.bundleSha256 !== entry.bundleSha256 ||
      bundle.bundleSha256 !== bundleSha256(bundle)
    )
      throw new AdapterRuntimeError(
        "ADAPTER_BUNDLE_HASH_MISMATCH",
        `Adapter bundle content hash does not match its index: ${id}`,
      );
    const frozen = deepFreeze(bundle);
    this.bundles.set(id, frozen);
    return frozen;
  }

  async loadForPlatform(id: string, platform: RuntimePlatform) {
    const bundle = await this.load(id);
    const rules = bundle.platforms[platform];
    if (!rules)
      throw new AdapterRuntimeError(
        "ADAPTER_PLATFORM_UNSUPPORTED",
        `Adapter ${id} does not support ${platform}.`,
      );
    return { bundle, platform, rules: deepFreeze(rules) };
  }
}
