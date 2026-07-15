import { fail, type Json, type OperationRunner } from "../../core.js";
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
  if (operation === "info")
    return { system: name, devices, operations: systemCapabilities };
  if (operation === "status")
    return {
      system: name,
      results: await Promise.all(
        devices.map(async (device) => ({
          device,
          result: await runner.execute(device, "status", {}),
        })),
      ),
    };
  if (operation === "emergency-stop") {
    const results = [];
    for (const device of devices)
      try {
        results.push({
          device,
          result: await runner.execute(device, "stop", {}),
        });
      } catch (error) {
        results.push({ device, error: (error as Error).message });
      }
    return { system: name, results };
  }
  const capability =
    operation === "smoke"
      ? "selftest"
      : operation === "collect"
        ? "capture"
        : "deploy";
  const results = [];
  for (const device of [...devices].sort())
    results.push({
      device,
      result: await runner.execute(device, capability, {}),
    });
  return { system: name, operation, results };
}
