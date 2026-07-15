import type { Adapter } from "../../core/adapters/types.js";
import { createDeclarativeAdapter } from "./declarative-adapter.js";
import { RuntimeAdapterRegistry } from "./registry.js";

/** Loads the compiled built-in bundles that ship beside the runtime package. */
export const loadBuiltinAdapters = async (
  registry = new RuntimeAdapterRegistry(),
): Promise<Adapter[]> => {
  const entries = await registry.list();
  return Promise.all(
    entries
      .filter((entry) => entry.status !== "disabled")
      .map(async (entry) =>
        createDeclarativeAdapter(await registry.get(entry.id)),
      ),
  );
};
