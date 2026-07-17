import {
  BenchPilotError,
  fail,
  type Json,
  type OperationRunner,
} from "../../core.js";
import {
  executeSystemCapability,
  systemCapabilityIntersection,
} from "../../application/systems/use-case.js";

export const availableSystemCapabilities = async (
  devices: string[],
  runner: OperationRunner,
) => systemCapabilityIntersection({ devices, runner });

/** @deprecated CLI compatibility bridge; orchestration lives in Application. */
export async function systemOperation(
  name: string,
  operation: string,
  runner: OperationRunner,
  config: Json,
): Promise<Json> {
  const system = (config.systems as Json | undefined)?.[name];
  if (
    !system ||
    typeof system !== "object" ||
    !Array.isArray((system as Json).devices)
  )
    fail("SYSTEM_NOT_FOUND", 3, `System not found: ${name}`);
  const devices = (system as Json).devices as string[];
  runner.emitSystemEvent("system.operation.started", {
    system: name,
    operation,
  });
  try {
    const result = await executeSystemCapability({
      system: name,
      capability: operation,
      devices,
      runner,
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
    runner.emitSystemEvent("system.operation.completed", { result });
    return result as unknown as Json;
  } catch (error) {
    runner.emitSystemEvent("system.operation.failed", {
      error: (error as { result?: Json }).result ?? {
        message: (error as Error).message,
      },
    });
    throw Object.assign(error as Error, { jsonlTerminalEmitted: true });
  }
}
