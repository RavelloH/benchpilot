import {
  type AdapterRegistry,
  type Capability,
  fail,
  type Json,
  type OperationRunner,
  type PathService,
  type ResolvedConfig,
} from "../../core.js";

export interface DeviceUseCaseDependencies {
  registry: AdapterRegistry;
  runner: OperationRunner;
  config: ResolvedConfig;
  paths: PathService;
}

/** Device command semantics, independent from argv, terminals, and rendering. */
export class DeviceUseCases {
  constructor(private readonly dependencies: DeviceUseCaseDependencies) {}

  private async resolve(instance: string) {
    const rawDevice = (
      this.dependencies.config.value.devices as Json | undefined
    )?.[instance];
    if (!rawDevice || typeof rawDevice !== "object")
      fail("DEVICE_NOT_FOUND", 3, `Device not found: ${instance}`);
    const adapter = this.dependencies.registry.get(
      String((rawDevice as Json).adapter),
    );
    const runtime = await this.dependencies.registry.createDevice(
      adapter,
      instance,
      rawDevice as Json,
      this.dependencies.config.value,
      this.dependencies.paths,
    );
    return { adapter, runtime };
  }

  private localizeCapabilities(
    adapter: Awaited<ReturnType<DeviceUseCases["resolve"]>>["adapter"],
    capabilities: ReturnType<
      Awaited<ReturnType<DeviceUseCases["resolve"]>>["runtime"]["capabilities"]
    >,
    locale?: string,
  ) {
    const translate = adapter.translate;
    if (!locale || !translate) return capabilities;
    return capabilities.map((capability) => ({
      ...capability,
      summary:
        translate(locale, `capability.${capability.id}.summary`) ??
        capability.summary,
      ...(capability.description
        ? {
            description:
              translate(locale, `capability.${capability.id}.description`) ??
              capability.description,
          }
        : {}),
    }));
  }

  async describe(instance: string, locale?: string) {
    const { adapter, runtime } = await this.resolve(instance);
    return {
      adapter: { id: adapter.id, summary: adapter.summary },
      capabilities: this.localizeCapabilities(
        adapter,
        runtime.capabilities(),
        locale,
      ),
    };
  }

  async capability(instance: string, capabilityId: string, locale?: string) {
    const { adapter, runtime } = await this.resolve(instance);
    const capability = this.localizeCapabilities(
      adapter,
      runtime.capabilities(),
      locale,
    ).find((item) => item.id === capabilityId);
    if (!capability)
      fail(
        "UNSUPPORTED_CAPABILITY",
        3,
        `Device ${instance} does not support ${capabilityId}.`,
      );
    return { adapter, capability: capability as Capability };
  }

  async execute(input: {
    device: string;
    capability: string;
    capabilityInput: Json;
    executionMode?: "interactive";
  }) {
    await this.capability(input.device, input.capability);
    return this.dependencies.runner.execute(
      input.device,
      input.capability,
      input.capabilityInput,
      input.executionMode ? { executionMode: input.executionMode } : undefined,
    );
  }
}

export const createDeviceUseCases = (dependencies: DeviceUseCaseDependencies) =>
  new DeviceUseCases(dependencies);
