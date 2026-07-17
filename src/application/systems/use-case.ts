import {
  BenchPilotError,
  type Json,
  type OperationRunner,
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

/** A system is a capability intersection; every child still enters OperationRunner. */
export async function executeSystemCapability(input: {
  system: string;
  capability: string;
  devices: string[];
  runner: OperationRunner;
  capabilityInput?: Json;
  policy?: SystemExecutionPolicy;
}): Promise<SystemOperationResult> {
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
