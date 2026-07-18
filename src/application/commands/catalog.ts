import { fail, type CapabilityDescriptor } from "../../core.js";
import type { CommandNode } from "./contracts.js";

export interface DynamicCommandCatalogSource {
  configuredDevices(): Promise<
    Array<{ id: string; summary?: string; available?: boolean }>
  >;
  configuredSystems(): Promise<
    Array<{ id: string; summary?: string; available?: boolean }>
  >;
  deviceCapabilities(id: string): Promise<CapabilityDescriptor[]>;
  systemCapabilities(id: string): Promise<CapabilityDescriptor[]>;
}

const capabilityNode = (
  group: "device" | "system",
  instance: string,
  capability: Partial<CapabilityDescriptor> & { id: string; summary: string },
): CommandNode => {
  const options = capability.options || [];
  return {
    id: `${group}.${instance}.${capability.id}`,
    path: [group, instance, capability.id],
    summaryKey: capability.summary,
    fields: options
      .filter((option) => option.positional !== undefined)
      .map((option) => ({
        name: option.name,
        summary: option.summary,
        required: option.required,
        schema: option.schema,
        secret: option.secret,
        aliases: option.aliases,
        positional: option.positional,
        repeatable: option.repeatable,
      })),
    options: options.map((option) => ({
      name: option.name,
      summary: option.summary,
      required: option.required,
      schema: option.schema,
      secret: option.secret,
      aliases: option.aliases,
      positional: option.positional,
      repeatable: option.repeatable,
    })),
    interaction: "never",
    availability: capability.availability || "available",
    safety: capability.safety,
    lockMode: capability.lockMode,
    defaultTimeoutMs: capability.defaultTimeoutMs,
    createsRun: capability.createsRun,
    inputSchema: capability.inputSchema,
    outputSchema: capability.outputSchema,
    handler: `${group}.execute`,
  };
};

/** Authoritative, read-only command tree for help and interactive selection. */
export class CommandCatalog {
  constructor(private readonly source: DynamicCommandCatalogSource) {}

  roots() {
    return commandRoots;
  }

  root(name: string) {
    return commandRoots.find((node) => node.path[0] === name);
  }

  async children(path: readonly string[]): Promise<CommandNode[]> {
    if (path.length !== 1 && path.length !== 2) return [];
    if (path[0] === "device") {
      if (path.length === 1)
        return (await this.source.configuredDevices()).map((device) => ({
          id: `device.${device.id}`,
          path: ["device", device.id],
          summaryKey: device.summary || device.id,
          fields: [],
          interaction: "when-incomplete",
          availability:
            device.available === false ? "unavailable" : "available",
          ...(device.available === false
            ? { unavailableReasonCode: "DEVICE_UNAVAILABLE" }
            : {}),
        }));
      return (await this.source.deviceCapabilities(path[1]!)).map(
        (capability) => capabilityNode("device", path[1]!, capability),
      );
    }
    if (path[0] === "system") {
      if (path.length === 1)
        return (await this.source.configuredSystems()).map((system) => ({
          id: `system.${system.id}`,
          path: ["system", system.id],
          summaryKey: system.summary || system.id,
          fields: [],
          interaction: "when-incomplete",
          availability:
            system.available === false ? "unavailable" : "available",
          ...(system.available === false
            ? { unavailableReasonCode: "SYSTEM_UNAVAILABLE" }
            : {}),
        }));
      return (await this.source.systemCapabilities(path[1]!)).map(
        (capability) => capabilityNode("system", path[1]!, capability),
      );
    }
    return [];
  }

  /**
   * Resolves a command immediately before execution. Dynamic nodes are read
   * again instead of trusting a menu choice or an argv path parsed earlier.
   */
  async executable(path: readonly string[]): Promise<CommandNode> {
    const [group, instance, capability] = path;
    if (group !== "device" && group !== "system")
      fail("USAGE_ERROR", 2, `Command is not executable: ${path.join(" ")}.`);
    if (!instance)
      fail(
        "USAGE_ERROR",
        2,
        `${group} execution requires a configured ${group} instance.`,
      );
    const instances = await this.children([group]);
    const instanceNode = instances.find((node) => node.path[1] === instance);
    if (!instanceNode)
      fail(
        group === "device" ? "DEVICE_NOT_FOUND" : "SYSTEM_NOT_FOUND",
        3,
        `${group === "device" ? "Device" : "System"} not found: ${instance}`,
      );
    const configuredInstance = instanceNode as CommandNode;
    if (configuredInstance.availability === "unavailable")
      fail(
        configuredInstance.unavailableReasonCode || "COMMAND_UNAVAILABLE",
        3,
        `${group} is unavailable: ${instance}`,
      );
    if (!capability)
      fail("USAGE_ERROR", 2, `${group} execution requires a capability.`);
    const node = (await this.children([group, instance])).find(
      (candidate) => candidate.path[2] === capability,
    );
    if (!node)
      fail(
        group === "device"
          ? "UNSUPPORTED_CAPABILITY"
          : "SYSTEM_CAPABILITY_UNAVAILABLE",
        3,
        `Capability ${capability} is unavailable for ${group} ${instance}.`,
      );
    return node as CommandNode;
  }
}

/** Static roots; Application may append context-dependent children at query time. */
export const commandRoots: readonly CommandNode[] = [
  {
    id: "init",
    path: ["init"],
    summaryKey: "command.init",
    fields: [
      { name: "project-id", required: true },
      { name: "project-name", required: true },
      { name: "locale", required: true },
    ],
    interaction: "when-incomplete",
  },
  {
    id: "doctor",
    path: ["doctor"],
    summaryKey: "command.doctor",
    fields: [],
    interaction: "never",
  },
  {
    id: "config",
    path: ["config"],
    summaryKey: "command.config",
    fields: [],
    interaction: "when-incomplete",
  },
  {
    id: "adapters",
    path: ["adapters"],
    summaryKey: "command.adapters",
    fields: [],
    interaction: "when-incomplete",
  },
  {
    id: "adapter",
    path: ["adapter"],
    summaryKey: "command.adapter",
    fields: [{ name: "adapter-id", required: true }],
    interaction: "when-incomplete",
  },
  {
    id: "devices",
    path: ["devices"],
    summaryKey: "command.devices",
    fields: [],
    interaction: "when-incomplete",
  },
  {
    id: "device",
    path: ["device"],
    summaryKey: "command.device",
    fields: [{ name: "device-instance", required: true }],
    interaction: "when-incomplete",
  },
  {
    id: "systems",
    path: ["systems"],
    summaryKey: "command.systems",
    fields: [],
    interaction: "when-incomplete",
  },
  {
    id: "system",
    path: ["system"],
    summaryKey: "command.system",
    fields: [{ name: "system-instance", required: true }],
    interaction: "when-incomplete",
  },
  {
    id: "runs",
    path: ["runs"],
    summaryKey: "command.runs",
    fields: [],
    interaction: "when-incomplete",
  },
  {
    id: "run",
    path: ["run"],
    summaryKey: "command.run",
    fields: [{ name: "run-id", required: true }],
    interaction: "when-incomplete",
  },
  {
    id: "locks",
    path: ["locks"],
    summaryKey: "command.locks",
    fields: [],
    interaction: "when-incomplete",
  },
  {
    id: "lock",
    path: ["lock"],
    summaryKey: "command.lock",
    fields: [{ name: "lock-id", required: true }],
    interaction: "when-incomplete",
  },
  {
    id: "approvals",
    path: ["approvals"],
    summaryKey: "command.approvals",
    fields: [],
    interaction: "when-incomplete",
  },
  {
    id: "approval",
    path: ["approval"],
    summaryKey: "command.approval",
    fields: [{ name: "approval-id", required: true }],
    interaction: "when-incomplete",
  },
  {
    id: "help",
    path: ["help"],
    summaryKey: "command.help",
    fields: [],
    interaction: "never",
  },
  {
    id: "version",
    path: ["version"],
    summaryKey: "command.version",
    fields: [],
    interaction: "never",
  },
];

export const approvalApproveNode: CommandNode = {
  id: "approval.approve",
  path: ["approval", "<approval-id>", "approve"],
  summaryKey: "command.approval.approve",
  fields: [{ name: "approval-id", required: true }],
  interaction: "required",
};
