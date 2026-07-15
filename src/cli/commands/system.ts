import {
  BenchPilotError,
  fail,
  type Json,
  type OperationRunner,
} from "../../core.js";
import { systemCapabilities } from "../help-renderer.js";

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
  const execute = (device: string, capability: string) =>
    runner.execute(
      device,
      capability,
      {},
      {
        eventScope: "child",
        eventContext: { system: name, device },
      },
    );
  try {
    let result: Json;
    if (operation === "info")
      result = { system: name, devices, operations: systemCapabilities };
    else if (operation === "status") {
      const settled = await Promise.allSettled(
        devices.map((device) => execute(device, "status")),
      );
      const results = settled.map((entry, index) =>
        entry.status === "fulfilled"
          ? { device: devices[index], result: entry.value }
          : {
              device: devices[index],
              error: {
                kind:
                  entry.reason instanceof BenchPilotError
                    ? entry.reason.kind
                    : "INTERNAL_ERROR",
                message: (entry.reason as Error).message,
              },
            },
      );
      result = { system: name, results };
      if (settled.some((entry) => entry.status === "rejected"))
        throw new BenchPilotError(
          "SYSTEM_OPERATION_FAILED",
          5,
          `System status failed: ${name}`,
          false,
          undefined,
          [],
          { system: name, results },
        );
    } else if (operation === "emergency-stop") {
      const results = [];
      for (const device of devices)
        try {
          results.push({ device, result: await execute(device, "stop") });
        } catch (error) {
          results.push({ device, error: (error as Error).message });
        }
      result = { system: name, results };
    } else {
      const capability =
        operation === "smoke"
          ? "selftest"
          : operation === "collect"
            ? "capture"
            : "deploy";
      const results = [];
      for (const device of [...devices].sort())
        results.push({ device, result: await execute(device, capability) });
      result = { system: name, operation, results };
    }
    runner.emitSystemEvent("system.operation.completed", { result });
    return result;
  } catch (error) {
    runner.emitSystemEvent("system.operation.failed", {
      error:
        error instanceof BenchPilotError
          ? { kind: error.kind, message: error.message, details: error.details }
          : { message: (error as Error).message },
    });
    throw Object.assign(error as Error, { jsonlTerminalEmitted: true });
  }
}
