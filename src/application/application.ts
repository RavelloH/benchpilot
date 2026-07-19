import type { Adapter } from "../core.js";
import { AdapterRegistry } from "../core.js";
import {
  hasProjectConfig,
  initializeProject,
  type InitializeProjectInput,
} from "./init/use-case.js";
import { commandRoots } from "./commands/catalog.js";
import { editConfiguration } from "./config/use-case.js";

/** Application composition root. CLI only invokes these use cases. */
export function createApplication(adapters: Adapter[]) {
  const registry = new AdapterRegistry();
  for (const adapter of adapters) registry.register(adapter);
  return {
    registry,
    commandRoots: () => commandRoots,
    editConfiguration,
    hasProjectConfig,
    initializeProject: (input: InitializeProjectInput) =>
      initializeProject(input),
  };
}
