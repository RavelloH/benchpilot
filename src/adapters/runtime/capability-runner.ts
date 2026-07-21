import path from "node:path";
import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import type { OperationContext } from "../../core/operations/types.js";
import type { Json } from "../../core/config/config.js";
import { executeCopy } from "./executors/copy-executor.js";
import { executeProcess } from "./executors/process-executor.js";
import { executeUnsupportedSerial } from "./executors/unsupported-executor.js";
import { executeWorkflow } from "./executors/workflow-executor.js";
import { AdapterRuntimeError } from "./errors.js";
import {
  EnvironmentResolver,
  environmentFor,
} from "./environments/resolver.js";
import { durationMs, planLaunch } from "./planning/launch-plan.js";
import { collectArtifacts } from "./rules/artifact-collector.js";
import { lookup, object, type RuleObject } from "./rules/template.js";
import { ToolResolver, type ResolvedToolLaunch } from "./tools/resolver.js";
import type { AdapterRuntimeContext, RuntimeAdapter } from "./types.js";
import { AdapterDataValidator } from "./validation/data-validator.js";
import {
  SecretRedactor,
  secretValuesWithSchema,
} from "./validation/secret-redactor.js";

/** A monotonic deadline shared by every action in a capability invocation. */
export class ExecutionDeadline {
  readonly startedAt = Date.now();
  readonly expiresAt: number;

  constructor(timeoutMs: number) {
    this.expiresAt = timeoutMs > 0 ? this.startedAt + timeoutMs : Infinity;
  }

  remainingMs(): number | undefined {
    return this.expiresAt === Infinity
      ? undefined
      : Math.max(0, this.expiresAt - Date.now());
  }

  limit(timeoutMs: number): number | undefined {
    const remaining = this.remainingMs();
    if (timeoutMs <= 0) return remaining;
    if (remaining === undefined) return timeoutMs;
    return Math.min(timeoutMs, remaining);
  }
}

const abortAfter = async <T>(
  signal: AbortSignal,
  timeoutMs: number | undefined,
  execute: (signal: AbortSignal) => Promise<T>,
) => {
  const controller = new AbortController();
  const onAbort = () => controller.abort(signal.reason);
  signal.addEventListener("abort", onAbort, { once: true });
  let timedOut = false;
  if (timeoutMs !== undefined && timeoutMs <= 0)
    throw new AdapterRuntimeError(
      "ADAPTER_ACTION_TIMEOUT",
      "Capability deadline has expired.",
      true,
      ["Retry the operation with a longer timeout."],
    );
  const timer =
    timeoutMs !== undefined
      ? setTimeout(() => {
          timedOut = true;
          controller.abort({ kind: "adapter-action-timeout" });
        }, timeoutMs)
      : undefined;
  try {
    const result = await execute(controller.signal);
    if (signal.aborted) throw signal.reason ?? new Error("Action aborted.");
    if (timedOut)
      throw new AdapterRuntimeError(
        "ADAPTER_ACTION_TIMEOUT",
        "Adapter action timed out.",
        true,
      );
    return result;
  } catch (error) {
    if (signal.aborted) throw signal.reason ?? error;
    if (timedOut)
      throw new AdapterRuntimeError(
        "ADAPTER_ACTION_TIMEOUT",
        "Adapter action timed out.",
        true,
        [
          "Retry the operation.",
          "Increase the operation timeout if the device or tool is slow.",
        ],
      );
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
    signal.removeEventListener("abort", onAbort);
  }
};

const runtimePlatform = () => {
  if (process.platform === "win32") return "windows";
  if (process.platform === "darwin") return "macos";
  return "linux";
};

/** Executes compiled Adapter v1 rules inside the existing Core operation lifecycle. */
export class DeclarativeCapabilityRunner {
  private readonly validator: AdapterDataValidator;
  private readonly environments = new EnvironmentResolver();
  private readonly tools = new ToolResolver(
    runtimePlatform(),
    process.env,
    "configured",
  );
  private operationTemp?: string;

  constructor(
    private readonly adapter: RuntimeAdapter,
    private readonly adapterConfig: Json,
    private readonly deviceConfig: Json,
  ) {
    this.validator = new AdapterDataValidator(adapter.bundle);
  }

  async execute(
    capabilityId: string,
    capability: RuleObject,
    operation: OperationContext,
    input: Json,
  ): Promise<Json> {
    if (operation.run) {
      this.operationTemp = path.join(operation.run.dir, "tmp");
      await mkdir(this.operationTemp, { recursive: true });
    } else {
      this.operationTemp = path.join(operation.stateRoot, "tmp", randomUUID());
      await mkdir(this.operationTemp, { recursive: true });
      operation.registerCleanup(
        "adapter-operation-temp",
        () => rm(this.operationTemp!, { recursive: true, force: true }),
        { critical: false, holdsPhysicalResource: false },
      );
    }
    const inputDefinition = String(capability.input_schema);
    const outputDefinition = String(capability.output_schema);
    const validatedInput = this.validator.validate(
      "input",
      input,
      capabilityId,
      inputDefinition,
    );
    const context: AdapterRuntimeContext & RuleObject = {
      adapter: {
        id: this.adapter.bundle.id,
        version: String(this.adapter.bundle.manifest.adapter_version),
        manifest: this.adapter.bundle.manifest,
      },
      platform: runtimePlatform(),
      config: this.adapterConfig,
      device: this.deviceConfig,
      input: validatedInput,
      project: { root: operation.project?.root ?? process.cwd() },
      home: process.env.HOME ?? process.env.USERPROFILE ?? "",
      temp: this.operationTemp,
      env: process.env,
      run: operation.run
        ? { dir: operation.run.dir, id: operation.run.id }
        : undefined,
      tool: {},
      discovery: {},
      environment: {},
      result: {},
    };
    const handler = String(capability.handler);
    const dangerous = object(capability.safety).mode !== "normal";
    const deadline = new ExecutionDeadline(durationMs(capability.timeout));
    const redactor = this.secretRedactor(validatedInput, inputDefinition);
    const executeAction = (
      id: string,
      actionInput: RuleObject,
      signal: AbortSignal,
    ) =>
      this.executeAction(
        id,
        actionInput,
        context,
        operation,
        signal,
        dangerous,
        capabilityId,
        deadline,
        true,
        redactor,
      );
    let result: RuleObject;
    if (handler.startsWith("action:"))
      result = await executeAction(
        handler.slice("action:".length),
        validatedInput,
        operation.signal,
      );
    else if (handler.startsWith("workflow:")) {
      const workflow = object(
        object(this.adapter.rules.workflows)[handler.slice("workflow:".length)],
      );
      if (!Object.keys(workflow).length)
        throw new AdapterRuntimeError(
          "ADAPTER_ACTION_FAILED",
          `Workflow does not exist: ${handler}`,
        );
      const execution = await executeWorkflow(
        { ...workflow, id: handler.slice("workflow:".length) },
        context,
        operation.signal,
        (id, actionInput, signal) =>
          this.executeAction(
            id,
            actionInput,
            context,
            operation,
            signal,
            dangerous,
            capabilityId,
            deadline,
            false,
            redactor,
          ),
        (event, data) =>
          operation.emitEvent(event, redactor.redactValue(data) as Json),
        deadline.limit(durationMs(workflow.timeout)),
      );
      result = object(context.result);
      const outputStep =
        typeof workflow.output === "string" ? workflow.output : undefined;
      if (outputStep) result = object(result[outputStep]);
      if (!Object.keys(result).length) result = execution as RuleObject;
    } else
      throw new AdapterRuntimeError(
        "ADAPTER_ACTION_FAILED",
        `Unsupported capability handler: ${handler}`,
      );
    return this.validator.validate(
      "output",
      result,
      capabilityId,
      outputDefinition,
    ) as Json;
  }

  private async executeAction(
    id: string,
    input: RuleObject,
    context: RuleObject,
    operation: OperationContext,
    signal: AbortSignal,
    dangerous: boolean,
    capabilityId: string,
    deadline: ExecutionDeadline,
    retainActionResult: boolean,
    redactor: SecretRedactor,
  ): Promise<RuleObject> {
    const action = object(object(this.adapter.rules.actions)[id]);
    if (!Object.keys(action).length)
      throw new AdapterRuntimeError(
        "ADAPTER_ACTION_FAILED",
        `Action does not exist: ${id}`,
      );
    // `context.input` is the capability input for the entire workflow. Each
    // Action receives an isolated view so later steps can still read it.
    const actionContext = { ...context, input } as RuleObject;
    return abortAfter(
      signal,
      deadline.limit(durationMs(action.timeout)),
      async (actionSignal) => {
        const tool =
          action.type === "process"
            ? await this.resolveTool(
                String(action.tool),
                actionContext,
                actionSignal,
              )
            : undefined;
        if (tool) this.writeToolDiscovery(context, tool);
        const environment = await this.environments.resolveDetailed(
          tool?.environmentId ?? "inherit",
          object(this.adapter.rules.environments),
          actionContext,
          actionSignal,
        );
        if (tool) {
          (context.environment as Record<string, RuleObject>)[
            tool.environmentId
          ] = {
            providerId: environment.providerId,
            strategy: environment.strategy,
            source: environment.source,
            variables: this.environmentSummary(environment.environment),
          };
          const probes = await this.tools.probeChain(
            tool,
            object(this.adapter.rules.discoveries),
            actionContext,
            object(this.adapter.rules.parsers),
            environment.environment,
            this.adapter.bundle.id,
            actionSignal,
            (message) => operation.logger.debug(redactor.redactText(message)),
            environmentFor(
              this.environments,
              object(this.adapter.rules.environments),
              actionContext,
              actionSignal,
            ),
          );
          this.writeToolProbes(context, tool, probes);
          const probe = probes.get(tool.toolId) ?? {};
          return this.executePlannedAction(
            id,
            action,
            actionContext,
            operation,
            actionSignal,
            {
              ...tool,
              ...(Object.keys(probe).length ? { probeResult: probe } : {}),
            },
            environment.environment,
            dangerous,
            capabilityId,
            retainActionResult,
            redactor,
          );
        }
        return this.executePlannedAction(
          id,
          action,
          actionContext,
          operation,
          actionSignal,
          undefined,
          environment.environment,
          dangerous,
          capabilityId,
          retainActionResult,
          redactor,
        );
      },
    );
  }

  private async executePlannedAction(
    id: string,
    action: RuleObject,
    actionContext: RuleObject,
    operation: OperationContext,
    signal: AbortSignal,
    tool: ResolvedToolLaunch | undefined,
    environment: NodeJS.ProcessEnv,
    dangerous: boolean,
    capabilityId: string,
    retainActionResult: boolean,
    redactor: SecretRedactor,
  ): Promise<RuleObject> {
    const plan = planLaunch(action, actionContext, tool, environment);
    const result = await (async () => {
      if (plan.kind === "process") {
        const parser = plan.parserId
          ? object(object(this.adapter.rules.parsers)[plan.parserId])
          : undefined;
        const execution = await executeProcess(
          plan,
          parser,
          signal,
          (event, data) => {
            const step = object(actionContext.step);
            const workflowId =
              typeof step.workflowId === "string" ? step.workflowId : undefined;
            const stepId = typeof step.id === "string" ? step.id : undefined;
            const displayId =
              typeof step.displayId === "string" ? step.displayId : undefined;
            operation.emitEvent(
              event,
              redactor.redactValue({
                ...data,
                ...(workflowId && stepId
                  ? {
                      workflowStep: {
                        workflowId,
                        stepId,
                        ...(displayId ? { displayId } : {}),
                      },
                    }
                  : {}),
              }) as Json,
            );
          },
          operation.logger,
          dangerous
            ? () =>
                operation.markDangerousEffectStarted({
                  adapterId: this.adapter.bundle.id,
                  capabilityId,
                  actionId: id,
                  actionType: "process",
                })
            : undefined,
          redactor,
        );
        return execution.result;
      }
      if (plan.kind === "copy")
        return await executeCopy(
          plan,
          this.allowedRoots(operation),
          dangerous
            ? () =>
                operation.markDangerousEffectStarted({
                  adapterId: this.adapter.bundle.id,
                  capabilityId,
                  actionId: id,
                  actionType: "copy",
                })
            : undefined,
          signal,
        );
      return executeUnsupportedSerial();
    })();
    const previousResult = object(actionContext.result);
    actionContext.result = {
      ...object(actionContext.result),
      ...(result as RuleObject),
    };
    if (plan.artifactSetId) {
      if (!operation.run)
        throw new AdapterRuntimeError(
          "ADAPTER_ARTIFACT_MISSING",
          "Artifacts require a capability that creates a Run.",
        );
      const set = object(
        object(this.adapter.rules.artifacts)[plan.artifactSetId],
      );
      await collectArtifacts(
        set,
        actionContext,
        operation.run,
        { register: (record) => operation.registerArtifact(record) },
        this.allowedRoots(operation),
        plan.kind === "process" ? plan.cwd : operation.run.dir,
        signal,
      );
    }
    if (!retainActionResult) actionContext.result = previousResult;
    return result as RuleObject;
  }

  private async resolveTool(
    toolId: string,
    context: RuleObject,
    signal: AbortSignal,
  ): Promise<ResolvedToolLaunch> {
    const tool = await this.tools.resolveLaunch(
      toolId,
      object(this.adapter.rules.tools),
      object(this.adapter.rules.discoveries),
      context,
    );
    return tool;
  }

  private writeToolDiscovery(context: RuleObject, tool: ResolvedToolLaunch) {
    for (const current of tool.chain) {
      (context.tool as Record<string, RuleObject>)[current.toolId] = {
        executable: current.executable,
        argsPrefix: current.argsPrefix,
        environmentId: current.environmentId,
        discoveryId: current.discoveryId,
        discoveredPath: current.discoveredPath,
        discoveredRoot: current.discoveredRoot,
      };
      (context.discovery as Record<string, RuleObject>)[current.discoveryId] = {
        path: current.discoveredPath,
        root: current.discoveredRoot,
        candidateId: current.candidateId,
      };
    }
  }

  private writeToolProbes(
    context: RuleObject,
    tool: ResolvedToolLaunch,
    probes: Map<string, RuleObject>,
  ) {
    for (const current of tool.chain) {
      const probe = probes.get(current.toolId) ?? {};
      if (!Object.keys(probe).length) continue;
      (context.tool as Record<string, RuleObject>)[current.toolId]!.probe =
        probe;
      (context.discovery as Record<string, RuleObject>)[
        current.discoveryId
      ]!.probe = probe;
    }
  }

  private environmentSummary(environment: NodeJS.ProcessEnv) {
    return Object.fromEntries(
      Object.entries(environment).map(([key, value]) => [
        key,
        value === undefined ? undefined : "[RESOLVED]",
      ]),
    );
  }

  private secretRedactor(input: RuleObject, inputDefinition: string) {
    const inputRoot = this.adapter.bundle.schemas.inputs;
    return new SecretRedactor([
      ...secretValuesWithSchema(
        this.adapter.bundle.schemas.config,
        this.adapter.bundle.schemas.config,
        this.adapterConfig,
      ),
      ...secretValuesWithSchema(
        this.adapter.bundle.schemas.device,
        this.adapter.bundle.schemas.device,
        this.deviceConfig,
      ),
      ...secretValuesWithSchema(
        inputRoot,
        object(object(inputRoot).$defs)[inputDefinition] ?? inputRoot,
        input,
      ),
    ]);
  }

  private allowedRoots(operation: OperationContext) {
    return [
      operation.project?.root ?? process.cwd(),
      path.join(operation.stateRoot, "adapters", this.adapter.bundle.id),
      ...(operation.run
        ? [path.join(operation.run.dir, "tmp")]
        : [this.operationTemp ?? path.join(operation.stateRoot, "tmp")]),
      ...(operation.run ? [operation.run.dir] : []),
    ].map((value) => path.resolve(value));
  }
}
