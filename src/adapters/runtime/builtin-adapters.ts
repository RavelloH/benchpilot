import type { Adapter } from "../../core/adapters/types.js";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { AdapterBundleLoader } from "./bundle-loader.js";
import { createDeclarativeAdapter } from "./declarative-adapter.js";
import { RuntimeAdapterRegistry } from "./registry.js";
import { espIdfInstallation } from "./esp-idf-installer.js";

const withBuiltinInstallation = (adapter: Adapter): Adapter =>
  adapter.id === "esp-idf"
    ? {
        ...adapter,
        installation: espIdfInstallation,
        configurationNotFound(discovery) {
          return discovery.tools.some(
            (tool) => tool.id === "idf" && tool.status === "unavailable",
          );
        },
      }
    : adapter;

/** Loads the compiled built-in bundles that ship beside the runtime package. */
export const loadBuiltinAdapters = async (
  registry = new RuntimeAdapterRegistry(),
): Promise<Adapter[]> => {
  const entries = await registry.list();
  const builtins = await Promise.all(
    entries
      .filter((entry) => entry.status !== "disabled")
      .map(async (entry) =>
        withBuiltinInstallation(
          createDeclarativeAdapter(await registry.get(entry.id)),
        ),
      ),
  );
  const testBundles = process.env.BENCHPILOT_TEST_ADAPTER_BUNDLES;
  if (!testBundles) return builtins;
  const root = pathToFileURL(
    `${resolve(testBundles)}${process.platform === "win32" ? "/" : "/"}`,
  );
  const fixtures = new RuntimeAdapterRegistry(new AdapterBundleLoader(root));
  const fixtureEntries = await fixtures.list();
  const fixtureAdapters = await Promise.all(
    fixtureEntries
      .filter((entry) => entry.status !== "disabled")
      .map(async (entry) =>
        withBuiltinInstallation(
          createDeclarativeAdapter(await fixtures.get(entry.id)),
        ),
      ),
  );
  return [...builtins, ...fixtureAdapters].sort((left, right) =>
    left.id.localeCompare(right.id),
  );
};
