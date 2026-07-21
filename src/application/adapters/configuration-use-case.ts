import { promises as fs } from "node:fs";
import path from "node:path";
import TOML from "@iarna/toml";
import {
  fail,
  getKey,
  setKey,
  type AdapterConfigurationDiscovery,
  type AdapterRegistry,
  type Json,
  type PathService,
  type ResolvedConfig,
  validateConfig,
} from "../../core.js";

const record = (value: unknown): Json =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Json)
    : {};

export interface AdapterConfigurationUseCaseDependencies {
  readonly registry: AdapterRegistry;
  readonly paths: PathService;
  readonly config: ResolvedConfig;
}

export interface AdapterConfigurationResult {
  readonly adapter: string;
  readonly path: string;
  readonly changed: boolean;
  readonly config: Json;
  readonly tools: AdapterConfigurationDiscovery["tools"];
}

/** Explicit global persistence for discovered or manually supplied Adapter config. */
export class AdapterConfigurationUseCases {
  constructor(
    private readonly dependencies: AdapterConfigurationUseCaseDependencies,
  ) {}

  private async readGlobalAdapterConfig(adapterId: string) {
    const target = this.dependencies.paths.globalConfig();
    let global: Json = {};
    try {
      global = record(TOML.parse(await fs.readFile(target, "utf8")));
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    return {
      target,
      global,
      adapterConfig: record(record(global.adapters)[adapterId]),
    };
  }

  private async persist(input: {
    adapterId: string;
    config: Json;
    tools: AdapterConfigurationDiscovery["tools"];
  }): Promise<AdapterConfigurationResult> {
    const adapter = this.dependencies.registry.get(input.adapterId);
    const stored = await this.readGlobalAdapterConfig(input.adapterId);
    const next = { ...stored.adapterConfig, ...input.config };
    adapter.configSchema.parse(next);
    const changed =
      JSON.stringify(stored.adapterConfig) !== JSON.stringify(next);
    if (!changed)
      return {
        adapter: input.adapterId,
        path: stored.target,
        changed: false,
        config: input.config,
        tools: input.tools,
      };
    setKey(stored.global, `adapters.${adapter.id}`, next);
    validateConfig(stored.global);
    await fs.mkdir(path.dirname(stored.target), { recursive: true });
    const temporary = `${stored.target}.${process.pid}.tmp`;
    await fs.writeFile(temporary, TOML.stringify(stored.global as never));
    await fs.rename(temporary, stored.target);
    return {
      adapter: input.adapterId,
      path: stored.target,
      changed: true,
      config: input.config,
      tools: input.tools,
    };
  }

  /** Persists an installer result only after the installer completed verification. */
  async persistVerified(
    adapterId: string,
    config: Json,
  ): Promise<AdapterConfigurationResult> {
    return this.persist({ adapterId, config, tools: [] });
  }

  async discover(adapterId: string): Promise<AdapterConfigurationResult> {
    const adapter = this.dependencies.registry.get(adapterId);
    const discovery = await this.dependencies.registry.discoverConfiguration(
      adapter,
      this.dependencies.config.value,
      this.dependencies.paths,
    );
    if (!discovery.ready)
      fail(
        "ADAPTER_CONFIGURATION_INCOMPLETE",
        3,
        `Adapter ${adapterId} could not resolve every required tool.`,
        { tools: discovery.tools },
      );
    return this.persist({
      adapterId,
      config: discovery.config,
      tools: discovery.tools,
    });
  }

  async configure(
    adapterId: string,
    assignments: readonly string[],
  ): Promise<AdapterConfigurationResult> {
    const adapter = this.dependencies.registry.get(adapterId);
    if (!assignments.length)
      fail(
        "USAGE_ERROR",
        2,
        "adapter configure requires at least one adapter path.",
      );
    const manual: Json = {};
    for (const assignment of assignments) {
      const separator = assignment.indexOf("=");
      if (separator < 1 || separator === assignment.length - 1)
        fail("USAGE_ERROR", 2, "adapter configure values must use key=value.");
      const key = assignment.slice(0, separator);
      if (getKey(manual, key) !== undefined)
        fail("USAGE_ERROR", 2, `Duplicate adapter configuration key: ${key}.`);
      setKey(manual, key, assignment.slice(separator + 1));
    }
    const stored = await this.readGlobalAdapterConfig(adapterId);
    const next = { ...stored.adapterConfig, ...manual };
    adapter.configSchema.parse(next);
    const candidate = structuredClone(this.dependencies.config.value);
    const effective = {
      ...record(record(candidate.adapters)[adapterId]),
      ...next,
    };
    setKey(candidate, `adapters.${adapterId}`, effective);
    const discovery = await this.dependencies.registry.discoverConfiguration(
      adapter,
      candidate,
      this.dependencies.paths,
    );
    if (!discovery.ready)
      fail(
        "ADAPTER_CONFIGURATION_INCOMPLETE",
        3,
        `Adapter ${adapterId} could not resolve every required tool.`,
        {
          tools: discovery.tools,
        },
      );

    return this.persist({ adapterId, config: manual, tools: discovery.tools });
  }
}

export const createAdapterConfigurationUseCases = (
  dependencies: AdapterConfigurationUseCaseDependencies,
) => new AdapterConfigurationUseCases(dependencies);
