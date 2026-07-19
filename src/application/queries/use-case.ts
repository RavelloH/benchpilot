import {
  type AdapterRegistry,
  BenchPilotError,
  describeCapability,
  fail,
  getKey,
  isSupportedNodeVersion,
  type Json,
  type PathService,
  type ResolvedConfig,
} from "../../core.js";

export interface QueryUseCaseDependencies {
  registry: AdapterRegistry;
  paths: PathService;
  project: Awaited<ReturnType<PathService["project"]>>;
  config: ResolvedConfig;
  nodeVersion: string;
}

/** Stable leaf paths for selectors; arrays and empty objects remain values. */
export function configurationKeyPaths(value: Json): string[] {
  const paths: string[] = [];
  const visit = (candidate: Json, prefix = "") => {
    if (
      !candidate ||
      typeof candidate !== "object" ||
      Array.isArray(candidate)
    ) {
      if (prefix) paths.push(prefix);
      return;
    }
    const entries = Object.entries(candidate);
    if (!entries.length) {
      if (prefix) paths.push(prefix);
      return;
    }
    for (const [key, child] of entries)
      visit(child as Json, prefix ? `${prefix}.${key}` : key);
  };
  visit(value);
  return paths.sort((left, right) => left.localeCompare(right));
}

/** Read-only command semantics and dynamic catalog queries. */
export class QueryUseCases {
  constructor(private readonly dependencies: QueryUseCaseDependencies) {}

  getConfiguration(key: string, showOrigin = false) {
    const value = getKey(this.dependencies.config.value, key);
    if (value === undefined)
      fail("CONFIG_KEY_NOT_FOUND", 3, `Configuration key not found: ${key}`);
    return {
      key,
      value,
      origin: showOrigin
        ? this.dependencies.config.origins.get(key)
        : undefined,
    };
  }

  configurationKeys() {
    return { keys: configurationKeyPaths(this.dependencies.config.value) };
  }

  resolvedConfiguration() {
    return {
      config: this.dependencies.config.value,
      origins: Object.fromEntries(this.dependencies.config.origins),
    };
  }

  explainConfiguration(key: string) {
    return {
      key,
      value: getKey(this.dependencies.config.value, key),
      origin: this.dependencies.config.origins.get(key),
      layers: this.dependencies.config.layers.map((layer) => ({
        scope: layer.scope,
        path: layer.path,
        value: getKey(layer.value, key),
      })),
    };
  }

  validateConfiguration() {
    return { valid: true as const };
  }

  async doctor(locale = "en") {
    const checks: Json[] = [
      {
        id: "node",
        status: isSupportedNodeVersion(this.dependencies.nodeVersion)
          ? "pass"
          : "fail",
        message: `Node.js ${this.dependencies.nodeVersion}`,
      },
      {
        id: "project",
        status: this.dependencies.project ? "pass" : "warn",
        message: this.dependencies.project
          ? this.dependencies.project.root
          : "No project discovered",
      },
      {
        id: "config",
        status: "pass",
        message: "TOML and configuration schema valid",
      },
    ];
    for (const adapter of this.dependencies.registry.list())
      checks.push(
        ...(
          await this.dependencies.registry.doctor(
            adapter,
            this.dependencies.config.value,
            this.dependencies.paths,
          )
        ).map((check) => {
          const value = check as Record<string, unknown>;
          const message =
            typeof value.messageKey === "string"
              ? (adapter.translate?.(locale, value.messageKey) ?? value.message)
              : value.message;
          return {
            adapter: adapter.id,
            ...value,
            ...(typeof message === "string" ? { message } : {}),
          };
        }),
      );
    return { checks };
  }

  listAdapters() {
    return {
      adapters: this.dependencies.registry.list().map((adapter) => ({
        id: adapter.id,
        version: adapter.version,
        summary: adapter.summary,
      })),
    };
  }

  adapterInfo(id: string) {
    const adapter = this.dependencies.registry.get(id);
    return {
      id: adapter.id,
      version: adapter.version,
      summary: adapter.summary,
    };
  }

  async adapterDoctor(id: string) {
    const adapter = this.dependencies.registry.get(id);
    return {
      checks: await this.dependencies.registry.doctor(
        adapter,
        this.dependencies.config.value,
        this.dependencies.paths,
      ),
    };
  }

  listConfiguredDevices() {
    return {
      devices: Object.entries(this.dependencies.config.value.devices || {}).map(
        ([id, value]) => ({ id, ...(value as Json) }),
      ),
    };
  }

  async scanDevices(adapterId?: string, probeRequested = false) {
    if (probeRequested)
      fail(
        "DEVICE_PROBE_CAPABILITY_REQUIRED",
        2,
        "Device probes must run as declared capabilities through the Operation Runner.",
      );
    const adapters = adapterId
      ? [this.dependencies.registry.get(adapterId)]
      : this.dependencies.registry.list();
    const scans = await Promise.all(
      adapters.map(async (adapter) => {
        try {
          const result = await this.dependencies.registry.discoverDetailed(
            adapter,
            this.dependencies.config.value,
            this.dependencies.paths,
          );
          return {
            adapter: adapter.id,
            devices: result.devices,
            sources: result.diagnostics,
          };
        } catch (error: unknown) {
          const known = error instanceof BenchPilotError ? error : undefined;
          return {
            adapter: adapter.id,
            devices: [],
            error: {
              kind: known?.kind || "ADAPTER_DISCOVERY_FAILED",
              message: known?.message || "Adapter discovery failed.",
            },
          };
        }
      }),
    );
    return {
      devices: scans.flatMap((scan) => scan.devices),
      adapters: scans.map(({ adapter, error, sources }) => ({
        adapter,
        error,
        ...(sources ? { sources } : {}),
      })),
    };
  }

  listSystems() {
    return {
      systems: Object.entries(this.dependencies.config.value.systems || {}).map(
        ([id, value]) => ({ id, ...(value as Json) }),
      ),
    };
  }

  async deviceCapabilities(instance: string) {
    const rawDevice = (this.dependencies.config.value.devices as Json)[
      instance
    ];
    if (!rawDevice || typeof rawDevice !== "object")
      fail("DEVICE_NOT_FOUND", 3, `Device not found: ${instance}`);
    const adapter = this.dependencies.registry.get(
      String((rawDevice as Json).adapter),
    );
    const device = await this.dependencies.registry.createDevice(
      adapter,
      instance,
      rawDevice as Json,
      this.dependencies.config.value,
      this.dependencies.paths,
    );
    return {
      adapter: { id: adapter.id, summary: adapter.summary },
      capabilities: device.capabilities().map(describeCapability),
    };
  }
}

export const createQueryUseCases = (dependencies: QueryUseCaseDependencies) =>
  new QueryUseCases(dependencies);
