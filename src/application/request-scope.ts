import {
  type Adapter,
  BenchPilotError,
  type Json,
  enabledAdapterIds,
  LockManager,
  OperationRunner,
  PathService,
  ApprovalManager,
  type ResolvedConfig,
  RunManager,
  type OperationReporter,
  type BusinessLogFactory,
} from "../core.js";
import { loadApplicationConfig } from "./config/loader.js";
import { createApplication } from "./application.js";
import {
  createRuntimeUseCases,
  type RuntimeUseCases,
} from "./runtime/use-case.js";
import {
  createRuntimeCommandUseCases,
  type RuntimeCommandUseCases,
} from "./runtime/command-use-case.js";
import { createQueryUseCases, type QueryUseCases } from "./queries/use-case.js";
import {
  createDeviceUseCases,
  type DeviceUseCases,
} from "./devices/use-case.js";
import {
  createSystemUseCases,
  type SystemUseCases,
} from "./systems/use-case.js";
import {
  createConfigurationUseCases,
  type ConfigurationUseCases,
} from "./config/use-case.js";
import {
  createConfigurationCommandUseCases,
  type ConfigurationCommandUseCases,
} from "./config/command-use-case.js";
import { CommandCatalog } from "./commands/catalog.js";
import {
  commandCatalogDefinition,
  globalOptionDefinitions,
  staticCommandDefinitions,
} from "./commands/definitions.js";
import { ApplicationDynamicCommandProvider } from "./commands/dynamic-provider.js";
import { CommandResolver } from "./commands/resolver.js";
import { CommandArgvParser } from "./commands/parser.js";
import { HelpDocumentService } from "./commands/help.js";
import { CommandInteractionService } from "./commands/interaction.js";
import { createApplicationCommandDispatcher } from "./commands/application-dispatcher.js";

export interface ApplicationRequest {
  cwd: string;
  configPath?: string;
  operation?: {
    timeout?: unknown;
    dryRun?: boolean;
    session?: string;
    benchpilotVersion?: string;
  };
  adapters: Adapter[];
  nodeVersion: string;
  reporter?: OperationReporter;
  businessLogs: BusinessLogFactory;
}

export interface ApplicationRequestScope {
  application: ReturnType<typeof createApplication>;
  paths: PathService;
  project: { root: string; config: string } | undefined;
  config: ResolvedConfig;
  runner: OperationRunner;
  runtime: RuntimeUseCases;
  runtimeCommands: RuntimeCommandUseCases;
  queries: QueryUseCases;
  devices: DeviceUseCases;
  systems: SystemUseCases;
  configuration: ConfigurationUseCases;
  configurationCommands: ConfigurationCommandUseCases;
  catalog: CommandCatalog;
  commandGraph: {
    definitions: typeof staticCommandDefinitions;
    globalOptions: typeof globalOptionDefinitions;
    provider: ApplicationDynamicCommandProvider;
    resolver: CommandResolver;
    parser: CommandArgvParser;
    help: HelpDocumentService;
    interaction: CommandInteractionService;
    dispatcher: ReturnType<typeof createApplicationCommandDispatcher>;
  };
}

/** Builds process-independent request services. CLI supplies only explicit input. */
export async function openApplicationRequest(
  request: ApplicationRequest,
): Promise<ApplicationRequestScope> {
  const paths = new PathService();
  const project = await paths.project(request.cwd, request.configPath);
  const config = await loadApplicationConfig(
    paths,
    project,
    request.configPath,
  );
  const enabled = enabledAdapterIds(config.value);
  const available = new Set(request.adapters.map((adapter) => adapter.id));
  const missing = enabled.filter((adapter) => !available.has(adapter));
  if (missing.length)
    throw new BenchPilotError(
      "UNKNOWN_ADAPTER",
      3,
      `Enabled adapter is not installed: ${missing[0]}.`,
    );
  const application = createApplication(
    request.adapters.filter((adapter) => enabled.includes(adapter.id)),
  );
  const lifecycle = {
    locks: new LockManager(paths),
    approvals: (projectRoot: string) => new ApprovalManager(paths, projectRoot),
    runs: (projectRoot: string) => new RunManager(paths, projectRoot),
  };
  const runner = new OperationRunner({
    paths,
    registry: application.registry,
    config,
    project,
    defaults: request.operation,
    reporter: request.reporter,
    businessLogs: request.businessLogs,
    lifecycle,
  });
  const runtime = createRuntimeUseCases({ paths, project, config, lifecycle });
  const runtimeCommands = createRuntimeCommandUseCases(runtime);
  const queries = createQueryUseCases({
    registry: application.registry,
    paths,
    project,
    config,
    nodeVersion: request.nodeVersion,
  });
  const devices = createDeviceUseCases({
    registry: application.registry,
    runner,
    config,
    paths,
  });
  const systems = createSystemUseCases({ runner, config, devices });
  const configuration = createConfigurationUseCases({ paths, project });
  const configurationCommands = createConfigurationCommandUseCases(
    queries,
    configuration,
  );
  const catalog = new CommandCatalog({
    async configuredDevices() {
      return queries.listConfiguredDevices().devices.map((device) => ({
        id: String(device.id),
      }));
    },
    async configuredSystems() {
      return queries.listSystems().systems.map((system) => ({
        id: String(system.id),
      }));
    },
    async deviceCapabilities(id) {
      return (await queries.deviceCapabilities(id)).capabilities;
    },
    async systemCapabilities(id) {
      return (await systems.describe(id)).capabilities;
    },
  });
  const provider = new ApplicationDynamicCommandProvider({
    queries,
    systems,
    runtime,
  });
  const commandGraph = {
    definitions: staticCommandDefinitions,
    globalOptions: globalOptionDefinitions,
    provider,
    resolver: new CommandResolver(staticCommandDefinitions, provider),
    parser: new CommandArgvParser(
      staticCommandDefinitions,
      globalOptionDefinitions,
      provider,
    ),
    help: new HelpDocumentService(commandCatalogDefinition, provider),
    interaction: new CommandInteractionService(staticCommandDefinitions),
    dispatcher: createApplicationCommandDispatcher({
      configuration: configurationCommands,
      runtime: runtimeCommands,
      queries,
      resolvedConfig: config,
    }),
  };
  return {
    application,
    paths,
    project,
    config,
    runner,
    runtime,
    runtimeCommands,
    queries,
    devices,
    systems,
    configuration,
    configurationCommands,
    catalog,
    commandGraph,
  };
}
