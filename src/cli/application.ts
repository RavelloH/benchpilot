import { AdapterRegistry, type Adapter } from "../core.js";

/**
 * Builds the process-independent adapter registry used by the CLI. Tests and
 * future hosts can inject adapters without changing any command routing.
 */
export function createBenchPilotApplication(adapters: Adapter[]) {
  const registry = new AdapterRegistry();
  for (const adapter of adapters) registry.register(adapter);
  return { registry };
}
