import {
  BenchPilotError,
  type CapabilityDescriptor,
  fail,
  stable,
  type Json,
  type OperationRunner,
  type ResolvedConfig,
} from "../../core.js";

export type SystemExecutionPolicy = "parallel" | "serial-fail-fast";

export interface SystemMemberOutcome {
  device: string;
  ok: boolean;
  result?: Json;
  error?: { kind: string; message: string; details?: Json };
}

export interface SystemOperationResult {
  system: string;
  capability: string;
  policy: SystemExecutionPolicy;
  results: SystemMemberOutcome[];
}

export type SystemCapabilityDescriptor = CapabilityDescriptor;

export interface SystemUseCaseDependencies {
  runner: OperationRunner;
  config: ResolvedConfig;
}

/** System command semantics, including lifecycle event orchestration. */
export class SystemUseCases {
  constructor(private readonly dependencies: SystemUseCaseDependencies) {}

  private members(name: string) {
    const system = (
      this.dependencies.config.value.systems as Json | undefined
    )?.[name];
    if (!system || typeof system !== "object")
      fail("SYSTEM_NOT_FOUND", 3, `System not found: ${name}`);
    const devices = (system as Json).devices;
    if (
      !Array.isArray(devices) ||
      !devices.every((device) => typeof device === "string")
    )
      fail("SYSTEM_NOT_FOUND", 3, `System has no valid members: ${name}`);
    return devices as string[];
  }

  async describe(name: string) {
    const devices = this.members(name);
    return {
      name,
      devices,
      capabilities: await systemCapabilityIntersection({
        devices,
        runner: this.dependencies.runner,
      }),
    };
  }

  async execute(name: string, capability: string, capabilityInput?: Json) {
    const devices = this.members(name);
    this.dependencies.runner.emitSystemEvent("system.operation.started", {
      system: name,
      operation: capability,
    });
    try {
      const result = await executeSystemCapability({
        system: name,
        capability,
        devices,
        runner: this.dependencies.runner,
        capabilityInput,
      });
      if (result.results.some((item) => !item.ok))
        throw Object.assign(
          new BenchPilotError(
            "SYSTEM_OPERATION_FAILED",
            5,
            `System operation failed: ${name}`,
            false,
            undefined,
            [],
            { result },
          ),
          { result },
        );
      this.dependencies.runner.emitSystemEvent("system.operation.completed", {
        result,
      });
      return result as unknown as Json;
    } catch (error) {
      this.dependencies.runner.emitSystemEvent("system.operation.failed", {
        error: (error as { result?: Json }).result ?? {
          message: (error as Error).message,
        },
      });
      throw Object.assign(error as Error, { jsonlTerminalEmitted: true });
    }
  }
}

export const createSystemUseCases = (dependencies: SystemUseCaseDependencies) =>
  new SystemUseCases(dependencies);

/** Returns only capabilities that are declared consistently by every member. */
export async function systemCapabilityIntersection(input: {
  devices: string[];
  runner: OperationRunner;
}): Promise<SystemCapabilityDescriptor[]> {
  const members = await Promise.all(
    [...input.devices].sort().map(async (device) => ({
      device,
      capabilities: await input.runner.listCapabilities(device),
    })),
  );
  if (!members.length) return [];
  const first = members[0]!.capabilities;
  return first
    .filter((candidate) =>
      members.every((member) => {
        const match = member.capabilities.find(
          (item) => item.id === candidate.id,
        );
        return (
          match &&
          match.lockMode === candidate.lockMode &&
          stable({
            safety: match.safety,
            inputSchema: match.inputSchema,
            options: match.options,
            defaultTimeoutMs: match.defaultTimeoutMs,
          }) ===
            stable({
              safety: candidate.safety,
              inputSchema: candidate.inputSchema,
              options: candidate.options,
              defaultTimeoutMs: candidate.defaultTimeoutMs,
            })
        );
      }),
    )
    .map((candidate) => structuredClone(candidate))
    .sort((left, right) => left.id.localeCompare(right.id));
}

/** A system is a capability intersection; every child still enters OperationRunner. */
export async function executeSystemCapability(input: {
  system: string;
  capability: string;
  devices: string[];
  runner: OperationRunner;
  capabilityInput?: Json;
  policy?: SystemExecutionPolicy;
}): Promise<SystemOperationResult> {
  const available = await systemCapabilityIntersection(input);
  if (!available.some((candidate) => candidate.id === input.capability))
    throw new BenchPilotError(
      "SYSTEM_CAPABILITY_UNAVAILABLE",
      3,
      `Capability ${input.capability} is not safely available on every system member.`,
      false,
      undefined,
      [],
      {
        system: input.system,
        capability: input.capability,
        devices: [...input.devices].sort(),
        available: available.map((candidate) => candidate.id),
      },
    );
  const approvals = await Promise.all(
    [...input.devices]
      .sort()
      .map((device) =>
        input.runner.preflightApproval(
          device,
          input.capability,
          structuredClone(input.capabilityInput ?? {}),
        ),
      ),
  );
  const pendingApprovalIds = approvals
    .filter((approval) => approval.required && !approval.ready)
    .map((approval) => approval.approvalId)
    .filter((id): id is string => Boolean(id));
  if (pendingApprovalIds.length)
    throw new BenchPilotError(
      "HUMAN_APPROVAL_REQUIRED",
      7,
      "Human approval is required before this system operation can run.",
      false,
      undefined,
      [],
      { approvalIds: pendingApprovalIds },
    );
  const policy =
    input.policy ??
    (input.capability === "status" ? "parallel" : "serial-fail-fast");
  const execute = (device: string) =>
    input.runner.execute(
      device,
      input.capability,
      structuredClone(input.capabilityInput ?? {}),
      {
        eventScope: "child",
        eventContext: { system: input.system, device },
      },
    );
  if (policy === "parallel") {
    const settled = await Promise.allSettled(input.devices.map(execute));
    const results = settled.map((entry, index): SystemMemberOutcome =>
      entry.status === "fulfilled"
        ? { device: input.devices[index]!, ok: true, result: entry.value }
        : {
            device: input.devices[index]!,
            ok: false,
            error: {
              kind:
                entry.reason instanceof BenchPilotError
                  ? entry.reason.kind
                  : "INTERNAL_ERROR",
              message: (entry.reason as Error).message,
              ...(entry.reason instanceof BenchPilotError
                ? { details: entry.reason.details as Json }
                : {}),
            },
          },
    );
    return {
      system: input.system,
      capability: input.capability,
      policy,
      results,
    };
  }
  const results: SystemMemberOutcome[] = [];
  for (const device of [...input.devices].sort()) {
    try {
      results.push({ device, ok: true, result: await execute(device) });
    } catch (error) {
      results.push({
        device,
        ok: false,
        error: {
          kind:
            error instanceof BenchPilotError ? error.kind : "INTERNAL_ERROR",
          message: (error as Error).message,
          ...(error instanceof BenchPilotError
            ? { details: error.details as Json }
            : {}),
        },
      });
      break;
    }
  }
  return {
    system: input.system,
    capability: input.capability,
    policy,
    results,
  };
}
