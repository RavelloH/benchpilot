import {
  type Adapter,
  type BenchPilotEventWriter,
  type Json,
  loadConfig,
  LockManager,
  OperationRunner,
  PathService,
  ApprovalManager,
  type ResolvedConfig,
  RunManager,
} from "../core.js";
import { createApplication } from "./application.js";
import {
  createRuntimeUseCases,
  type RuntimeUseCases,
} from "./runtime/use-case.js";
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
import { CommandCatalog } from "./commands/catalog.js";

export interface ApplicationRequest {
  cwd: string;
  configPath?: string;
  flags: Json;
  adapters: Adapter[];
  nodeVersion: string;
  eventWriter?: BenchPilotEventWriter;
}

export interface ApplicationRequestScope {
  application: ReturnType<typeof createApplication>;
  paths: PathService;
  project: { root: string; config: string } | undefined;
  config: ResolvedConfig;
  runner: OperationRunner;
  runtime: RuntimeUseCases;
  queries: QueryUseCases;
  devices: DeviceUseCases;
  systems: SystemUseCases;
  configuration: ConfigurationUseCases;
  catalog: CommandCatalog;
}

/** Builds process-independent request services. CLI supplies only explicit input. */
export async function openApplicationRequest(
  request: ApplicationRequest,
): Promise<ApplicationRequestScope> {
  const paths = new PathService();
  const project = await paths.project(request.cwd, request.configPath);
  const config = await loadConfig(paths, project, request.configPath);
  const application = createApplication(request.adapters);
  const runner = new OperationRunner({
    paths,
    registry: application.registry,
    config,
    project,
    flags: request.flags,
    eventWriter: request.eventWriter,
    lifecycle: {
      locks: new LockManager(paths),
      approvals: new ApprovalManager(paths),
      runs: (projectKey) => new RunManager(paths, projectKey),
    },
  });
  const runtime = createRuntimeUseCases({ paths, project, config });
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
  const systems = createSystemUseCases({ runner, config });
  const configuration = createConfigurationUseCases({ paths, project });
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
  return {
    application,
    paths,
    project,
    config,
    runner,
    runtime,
    queries,
    devices,
    systems,
    configuration,
    catalog,
  };
}
