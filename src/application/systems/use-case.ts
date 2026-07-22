import {
  BenchPilotError,
  type CapabilityDescriptor,
  type Capability,
  fail,
  stable,
  type Json,
  type OperationRunner,
  type OperationOutcome,
  type ResolvedConfig,
} from "../../core.js";
import type { DeviceUseCases } from "../devices/use-case.js";

export type SystemExecutionPolicy = "parallel" | "serial-fail-fast";

export interface SystemMemberOutcome {
  device: string;
  ok: boolean;
  result?: Json;
  error?: { kind: string; message: string; details?: Json };
  /** Final core lifecycle facts when the runner reached execution. */
  outcome?: OperationOutcome;
}

export interface SystemOperationResult {
  system: string;
  capability: string;
  policy: SystemExecutionPolicy;
  results: SystemMemberOutcome[];
}

export interface SystemMember {
  device: string;
  role?: string;
}

export interface SystemDefinition {
  name?: string;
  description?: string;
  labels?: string[];
  members: SystemMember[];
}

export type SystemCapabilityDescriptor = CapabilityDescriptor;

export interface SystemUseCaseDependencies {
  runner: OperationRunner;
  config: ResolvedConfig;
  devices: DeviceUseCases;
}

/** System command semantics, including lifecycle event orchestration. */
export class SystemUseCases {
  constructor(private readonly dependencies: SystemUseCaseDependencies) {}

  private definition(name: string): SystemDefinition {
    const system = (
      this.dependencies.config.value.systems as Json | undefined
    )?.[name];
    if (!system || typeof system !== "object")
      fail("SYSTEM_NOT_FOUND", 3, `System not found: ${name}`);
    const value = system as Json;
    const members = value.members;
    if (
      !Array.isArray(members) ||
      !members.length ||
      !members.every(
        (member) =>
          member &&
          typeof member === "object" &&
          typeof (member as Json).device === "string",
      )
    )
      fail("SYSTEM_NOT_FOUND", 3, `System has no valid members: ${name}`);
    return {
      ...(typeof value.name === "string" ? { name: value.name } : {}),
      ...(typeof value.description === "string"
        ? { description: value.description }
        : {}),
      ...(Array.isArray(value.labels) &&
      value.labels.every((label) => typeof label === "string")
        ? { labels: value.labels as string[] }
        : {}),
      members: (members as Json[]).map((member) => {
        const value = member as Json;
        return {
          device: String(value.device),
          ...(typeof value.role === "string" ? { role: value.role } : {}),
        };
      }),
    };
  }

  private members(name: string) {
    return this.definition(name).members.map((member) => member.device);
  }

  async describe(name: string) {
    const definition = this.definition(name);
    const devices = definition.members.map((member) => member.device);
    const capabilities = await systemCapabilityIntersection({
      devices,
      runner: this.dependencies.runner,
    });
    return {
      name,
      ...(definition.name ? { displayName: definition.name } : {}),
      ...(definition.description
        ? { description: definition.description }
        : {}),
      ...(definition.labels ? { labels: definition.labels } : {}),
      members: definition.members,
      devices,
      capabilities,
    };
  }

  /**
   * Returns a real capability definition only after the system intersection
   * confirms that every member exposes compatible safety/input metadata.
   */
  async capability(name: string, capabilityId: string): Promise<Capability> {
    const description = await this.describe(name);
    if (!description.capabilities.some((item) => item.id === capabilityId))
      fail(
        "SYSTEM_CAPABILITY_UNAVAILABLE",
        3,
        `Capability ${capabilityId} is not safely available on every system member.`,
      );
    const first = [...description.devices].sort()[0];
    if (!first) fail("SYSTEM_NOT_FOUND", 3, `System has no members: ${name}`);
    return (await this.dependencies.devices.capability(first!, capabilityId))
      .capability;
  }

  /** Returns member lifecycle facts for the public CLI result projection. */
  async executeDetailed(
    name: string,
    capability: string,
    capabilityInput?: Json,
    options?: { executionMode?: "interactive" },
  ) {
    return executeSystemCapability({
      system: name,
      capability,
      devices: this.members(name),
      runner: this.dependencies.runner,
      capabilityInput,
      executionMode: options?.executionMode,
    });
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
            outputSchema: match.outputSchema,
            options: match.options,
            defaultTimeoutMs: match.defaultTimeoutMs,
            createsRun: match.createsRun,
          }) ===
            stable({
              safety: candidate.safety,
              inputSchema: candidate.inputSchema,
              outputSchema: candidate.outputSchema,
              options: candidate.options,
              defaultTimeoutMs: candidate.defaultTimeoutMs,
              createsRun: candidate.createsRun,
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
  executionMode?: "interactive";
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
  const approvals =
    input.executionMode === "interactive"
      ? []
      : await Promise.all(
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
  const execute = async (device: string) => {
    let outcome: OperationOutcome | undefined;
    try {
      const result = await input.runner.execute(
        device,
        input.capability,
        structuredClone(input.capabilityInput ?? {}),
        {
          eventScope: "child",
          eventContext: { system: input.system, device },
          executionMode: input.executionMode,
          onOutcome: (value) => {
            outcome = value;
          },
        },
      );
      return { result, outcome };
    } catch (error) {
      const failed = (error as { outcome?: OperationOutcome }).outcome;
      if (!failed) throw error;
      return {
        result: (error as { result?: Json }).result ?? failed.result,
        outcome: failed,
      };
    }
  };
  if (policy === "parallel") {
    const settled = await Promise.allSettled(input.devices.map(execute));
    const results = settled.map((entry, index): SystemMemberOutcome =>
      entry.status === "fulfilled"
        ? {
            device: input.devices[index]!,
            ok: !entry.value.outcome?.primaryError,
            result: entry.value.result,
            ...(entry.value.outcome ? { outcome: entry.value.outcome } : {}),
          }
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
      const member = await execute(device);
      results.push({
        device,
        ok: !member.outcome?.primaryError,
        result: member.result,
        ...(member.outcome ? { outcome: member.outcome } : {}),
      });
      if (member.outcome?.primaryError) break;
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
