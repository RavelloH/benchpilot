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

export interface ApplicationRequest {
  cwd: string;
  configPath?: string;
  flags: Json;
  adapters: Adapter[];
  eventWriter?: BenchPilotEventWriter;
}

export interface ApplicationRequestScope {
  application: ReturnType<typeof createApplication>;
  paths: PathService;
  project: { root: string; config: string } | undefined;
  config: ResolvedConfig;
  runner: OperationRunner;
  runtime: RuntimeUseCases;
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
  return { application, paths, project, config, runner, runtime };
}
