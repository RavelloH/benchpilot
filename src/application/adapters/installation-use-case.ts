import { promises as fs } from "node:fs";
import path from "node:path";
import {
  type BusinessLogFactory,
  fail,
  type AdapterRegistry,
  type Json,
  type OperationReporter,
  type PathService,
} from "../../core.js";
import type { AdapterConfigurationUseCases } from "./configuration-use-case.js";

const noopReporter: OperationReporter = { emit() {} };

export class AdapterInstallationUseCases {
  constructor(
    private readonly dependencies: {
      registry: AdapterRegistry;
      paths: PathService;
      businessLogs: BusinessLogFactory;
      configuration: AdapterConfigurationUseCases;
      reporter?: OperationReporter;
    },
  ) {}

  describe(adapterId: string) {
    const adapter = this.dependencies.registry.get(adapterId);
    const installation = adapter.installation?.();
    if (!installation)
      fail(
        "ADAPTER_INSTALLATION_UNAVAILABLE",
        3,
        `Adapter ${adapterId} does not provide an installer.`,
      );
    return installation!;
  }

  async install(adapterId: string, values: Json, root?: string) {
    const installation = this.describe(adapterId);
    const platform =
      process.platform === "win32"
        ? "windows"
        : process.platform === "darwin"
          ? "macos"
          : "linux";
    if (!installation.platforms.includes(platform))
      fail(
        "ADAPTER_INSTALLATION_UNAVAILABLE",
        3,
        `Adapter ${adapterId} does not support installation on ${platform}.`,
      );
    const managedRoot = path.join(
      this.dependencies.paths.managedToolsRoot(),
      adapterId,
    );
    const targetRoot = path.resolve(root || managedRoot);
    const baseReporter = this.dependencies.reporter ?? noopReporter;
    const reporter =
      baseReporter.child?.({ adapter: adapterId }) ?? baseReporter;
    const logsRoot = path.join(targetRoot, "logs");
    await fs.mkdir(logsRoot, { recursive: true });
    const startedAt = new Date().toISOString().replace(/[:.]/g, "-");
    const logger = this.dependencies.businessLogs.open({
      logFilePath: path.join(logsRoot, `install-${startedAt}.log`),
      jsonlFilePath: path.join(logsRoot, `install-${startedAt}.jsonl`),
      context: {
        domain: "adapter.install",
        adapter: adapterId,
        root: targetRoot,
      },
    });
    reporter.emit("adapter.install.started", {
      adapter: adapterId,
      root: targetRoot,
      estimate: installation.estimate,
      stability: installation.stability,
    });
    logger.event("adapter.install.started", {
      adapter: adapterId,
      root: targetRoot,
    });
    try {
      const result = await installation.install({
        paths: this.dependencies.paths,
        root: targetRoot,
        values,
        reporter,
        logger,
      });
      const configuration =
        result.configuration &&
        typeof result.configuration === "object" &&
        !Array.isArray(result.configuration)
          ? (result.configuration as Json)
          : undefined;
      if (!configuration)
        throw new Error(
          `Adapter ${adapterId} installer returned no verified configuration.`,
        );
      const persisted = await this.dependencies.configuration.persistVerified(
        adapterId,
        configuration,
      );
      reporter.emit("adapter.install.completed", {
        adapter: adapterId,
        root: targetRoot,
      });
      logger.event("adapter.install.completed", {
        adapter: adapterId,
        root: targetRoot,
        configurationPath: persisted.path,
      });
      return {
        adapter: adapterId,
        root: targetRoot,
        stability: installation.stability,
        estimate: installation.estimate,
        path: persisted.path,
        changed: persisted.changed,
        configuration,
        result,
      };
    } catch (error) {
      reporter.emit("adapter.install.failed", {
        adapter: adapterId,
        root: targetRoot,
        message:
          error instanceof Error ? error.message : "Installation failed.",
      });
      logger.event(
        "adapter.install.failed",
        {
          adapter: adapterId,
          root: targetRoot,
          message:
            error instanceof Error ? error.message : "Installation failed.",
        },
        { level: "error" },
      );
      throw error;
    } finally {
      await logger.close();
    }
  }
}

export const createAdapterInstallationUseCases = (
  dependencies: ConstructorParameters<typeof AdapterInstallationUseCases>[0],
) => new AdapterInstallationUseCases(dependencies);
