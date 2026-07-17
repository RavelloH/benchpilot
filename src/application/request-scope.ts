import {
  type Adapter,
  type BenchPilotEventWriter,
  type Json,
  loadConfig,
  OperationRunner,
  PathService,
  type ResolvedConfig,
} from "../core.js";
import { createApplication } from "./application.js";
import {
  createRuntimeUseCases,
  type RuntimeUseCases,
} from "./runtime/use-case.js";
import { createQueryUseCases, type QueryUseCases } from "./queries/use-case.js";

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
  });
  const runtime = createRuntimeUseCases({ paths, project, config });
  const queries = createQueryUseCases({
    registry: application.registry,
    paths,
    project,
    config,
    nodeVersion: request.nodeVersion,
  });
  return { application, paths, project, config, runner, runtime, queries };
}
