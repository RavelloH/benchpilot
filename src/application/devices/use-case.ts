import {
  type AdapterRegistry,
  BenchPilotError,
  type Capability,
  fail,
  type Json,
  type OperationRunner,
  type OperationOutcome,
  type PathService,
  type ResolvedConfig,
  type ManagedSessionPlan,
  type DeviceRuntime,
  type OperationExecutionOptions,
} from "../../core.js";

export interface DeviceUseCaseDependencies {
  registry: AdapterRegistry;
  runner: OperationRunner;
  config: ResolvedConfig;
  paths: PathService;
  project: { root: string; config: string } | undefined;
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

  async describe(instance: string) {
    const { adapter, runtime } = await this.resolve(instance);
    return {
      adapter: { id: adapter.id, summary: adapter.summary },
      capabilities: runtime.capabilities(),
    };
  }

  async capability(instance: string, capabilityId: string) {
    const { adapter, runtime } = await this.resolve(instance);
    const capability = runtime
      .capabilities()
      .find((item) => item.id === capabilityId);
    if (!capability)
      fail(
        "UNSUPPORTED_CAPABILITY",
        3,
        `Device ${instance} does not support ${capabilityId}.`,
      );
    return { adapter, capability: capability as Capability };
  }

  async managedSession(
    instance: string,
    capabilityId: string,
  ): Promise<{
    identity: DeviceRuntime["identity"];
    plan: ManagedSessionPlan;
  }> {
    const { runtime } = await this.resolve(instance);
    const project = this.dependencies.project;
    if (!project)
      throw new BenchPilotError(
        "PROJECT_NOT_FOUND",
        3,
        "A BenchPilot project is required for managed sessions.",
      );
    const plan = runtime.resolveManagedSession?.(capabilityId, {
      projectRoot: project.root,
    });
    if (!plan)
      throw new BenchPilotError(
        "UNSUPPORTED_CAPABILITY",
        3,
        `Device ${instance} does not support managed session ${capabilityId}.`,
      );
    return { identity: runtime.identity, plan };
  }

  async execute(input: {
    device: string;
    capability: string;
    capabilityInput: Json;
    approvalMode?: "agent";
    attachManagedSessionConsole?: OperationExecutionOptions["attachManagedSessionConsole"];
  }) {
    await this.capability(input.device, input.capability);
    return this.dependencies.runner.execute(
      input.device,
      input.capability,
      input.capabilityInput,
      {
        approvalMode: input.approvalMode,
        attachManagedSessionConsole: input.attachManagedSessionConsole,
      },
    );
  }

  /** Returns final lifecycle facts for public rendering without exposing v2 output. */
  async executeDetailed(input: {
    device: string;
    capability: string;
    capabilityInput: Json;
    approvalMode?: "agent";
    attachManagedSessionConsole?: OperationExecutionOptions["attachManagedSessionConsole"];
  }) {
    await this.capability(input.device, input.capability);
    let outcome: OperationOutcome | undefined;
    try {
      await this.dependencies.runner.execute(
        input.device,
        input.capability,
        input.capabilityInput,
        {
          approvalMode: input.approvalMode,
          attachManagedSessionConsole: input.attachManagedSessionConsole,
          onOutcome: (value) => {
            outcome = value;
          },
        },
      );
    } catch (error) {
      const failed = (error as { outcome?: typeof outcome }).outcome;
      if (failed) return failed;
      throw error;
    }
    if (!outcome)
      throw new Error("Operation completed without lifecycle outcome.");
    return outcome;
  }
}

export const createDeviceUseCases = (dependencies: DeviceUseCaseDependencies) =>
  new DeviceUseCases(dependencies);
