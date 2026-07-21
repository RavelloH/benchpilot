import { enabledAdapterIds, fail, type ResolvedConfig } from "../../core.js";
import type { ConfigurationUseCases } from "../config/use-case.js";

export interface AdapterManagementUseCaseDependencies {
  readonly adapterIds: readonly string[];
  readonly config: ResolvedConfig;
  readonly project: { root: string; config: string } | undefined;
  readonly configuration: ConfigurationUseCases;
}

export interface AdapterManagementResult {
  readonly adapter: string;
  readonly enabled: boolean;
  readonly changed: boolean;
  readonly scope: "project";
  readonly path: string;
  readonly adapters: readonly string[];
}

/** Project-scoped adapter selection, independent from CLI parsing and rendering. */
export class AdapterManagementUseCases {
  private readonly adapterIds: ReadonlySet<string>;

  constructor(
    private readonly dependencies: AdapterManagementUseCaseDependencies,
  ) {
    this.adapterIds = new Set(dependencies.adapterIds);
  }

  async setEnabled(
    adapter: string,
    enabled: boolean,
  ): Promise<AdapterManagementResult> {
    if (!this.adapterIds.has(adapter))
      fail("UNKNOWN_ADAPTER", 3, `Unknown adapter: ${adapter}`);
    const project = this.dependencies.project;
    if (!project) {
      fail(
        "PROJECT_NOT_FOUND",
        3,
        "A BenchPilot project is required to manage adapters.",
      );
      throw new Error("PROJECT_NOT_FOUND must throw.");
    }

    const current = enabledAdapterIds(this.dependencies.config.value);
    const next = enabled
      ? current.includes(adapter)
        ? current
        : [...current, adapter]
      : current.filter((id) => id !== adapter);
    if (next.length === current.length)
      return {
        adapter,
        enabled,
        changed: false,
        scope: "project",
        path: project.config,
        adapters: current,
      };
    await this.dependencies.configuration.edit({
      scopes: ["project"],
      key: "adapters.enabled",
      value: JSON.stringify(next),
    });
    return {
      adapter,
      enabled,
      changed: true,
      scope: "project",
      path: project.config,
      adapters: next,
    };
  }
}

export const createAdapterManagementUseCases = (
  dependencies: AdapterManagementUseCaseDependencies,
) => new AdapterManagementUseCases(dependencies);
