import type { Json } from "../../core.js";
import { BenchPilotError, fail } from "../errors/benchpilot-error.js";
import { SchemaValidationError } from "./schemas.js";
import type { Adapter } from "./types.js";

export class AdapterRegistry {
  private adapters = new Map<string, Adapter>();
  register(adapter: Adapter) {
    if (!/^[a-z][a-z0-9-]*$/.test(adapter.id))
      fail("INVALID_ADAPTER_DEFINITION", 8, "Adapter id is invalid.");
    if (this.adapters.has(adapter.id))
      fail("DUPLICATE_ADAPTER", 8, `Adapter already registered: ${adapter.id}`);
    if (adapter.apiVersion !== 1)
      fail(
        "UNSUPPORTED_ADAPTER_API_VERSION",
        8,
        `Adapter ${adapter.id} requires API version 1.`,
      );
    if (!adapter.version || !adapter.summary || !adapter.configSchema)
      fail(
        "INVALID_ADAPTER_DEFINITION",
        8,
        `Adapter ${adapter.id} requires a version, summary, and configSchema.`,
      );
    for (const method of ["discover", "doctor", "createDevice"] as const)
      if (typeof adapter[method] !== "function")
        fail(
          "INVALID_ADAPTER_DEFINITION",
          8,
          `Adapter ${adapter.id} requires ${method}().`,
        );
    this.adapters.set(adapter.id, adapter);
  }
  get(id: string): Adapter {
    const adapter = this.adapters.get(id);
    if (!adapter) fail("UNKNOWN_ADAPTER", 3, `Unknown adapter: ${id}`);
    return adapter!;
  }
  list() {
    return [...this.adapters.values()];
  }
  configFor(adapter: Adapter, config: Json): Json {
    const raw = ((config.adapters as Json | undefined)?.[adapter.id] ||
      {}) as Json;
    try {
      return adapter.configSchema.parse(raw);
    } catch (error) {
      const detail =
        error instanceof SchemaValidationError ? error.path.join(".") : "";
      throw new BenchPilotError(
        "INVALID_ADAPTER_CONFIG",
        3,
        `Adapter ${adapter.id} configuration is invalid${detail ? ` at ${detail}` : ""}: ${(error as Error).message}`,
        false,
        undefined,
        [`Check [adapters.${adapter.id}] in your configuration.`],
      );
    }
  }
  async createDevice(
    adapter: Adapter,
    instance: string,
    deviceConfig: Json,
    config: Json,
  ) {
    this.configFor(adapter, config);
    if (adapter.deviceConfigSchema)
      try {
        deviceConfig = adapter.deviceConfigSchema.parse(deviceConfig);
      } catch (error) {
        throw new BenchPilotError(
          "INVALID_DEVICE_CONFIG",
          3,
          `Device ${instance} configuration for ${adapter.id} is invalid: ${(error as Error).message}`,
        );
      }
    return adapter.createDevice(instance, deviceConfig);
  }
}
