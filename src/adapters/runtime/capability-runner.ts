import { tmpdir } from "node:os";
import path from "node:path";
import type { OperationContext } from "../../core/operations/types.js";
import type { Json } from "../../core/config/config.js";
import { executeCopy } from "./executors/copy-executor.js";
import { executeProcess } from "./executors/process-executor.js";
import { executeUnsupportedSerial } from "./executors/unsupported-executor.js";
import { executeWorkflow } from "./executors/workflow-executor.js";
import { AdapterRuntimeError } from "./errors.js";
import { EnvironmentResolver } from "./environments/resolver.js";
import { durationMs, planLaunch } from "./planning/launch-plan.js";
import { collectArtifacts } from "./rules/artifact-collector.js";
import { lookup, object, type RuleObject } from "./rules/template.js";
import { ToolResolver, type ResolvedTool } from "./tools/resolver.js";
import type { AdapterRuntimeContext, RuntimeAdapter } from "./types.js";
import { AdapterDataValidator } from "./validation/data-validator.js";

/** A monotonic deadline shared by every action in a capability invocation. */
export class ExecutionDeadline {
  readonly startedAt = Date.now();
  readonly expiresAt: number;

  constructor(timeoutMs: number) {
    this.expiresAt = timeoutMs > 0 ? this.startedAt + timeoutMs : Infinity;
  }

  remainingMs() {
    return this.expiresAt === Infinity
      ? 0
      : Math.max(0, this.expiresAt - Date.now());
  }

  limit(timeoutMs: number) {
    const remaining = this.remainingMs();
    if (timeoutMs <= 0) return remaining;
    if (this.expiresAt === Infinity) return timeoutMs;
    return Math.max(1, Math.min(timeoutMs, remaining));
  }
}

const abortAfter = async <T>(
  signal: AbortSignal,
  timeoutMs: number,
  execute: (signal: AbortSignal) => Promise<T>,
) => {
  const controller = new AbortController();
  const onAbort = () => controller.abort(signal.reason);
  signal.addEventListener("abort", onAbort, { once: true });
  let timedOut = false;
  const timer =
    timeoutMs > 0
      ? setTimeout(() => {
          timedOut = true;
          controller.abort({ kind: "adapter-action-timeout" });
        }, timeoutMs)
      : undefined;
  try {
    return await execute(controller.signal);
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
  private readonly tools = new ToolResolver(runtimePlatform(), process.env);

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
      temp: tmpdir(),
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
          ),
        (event, data) => operation.emitEvent(event, data as Json),
      );
      result = object(context.result);
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
  ): Promise<RuleObject> {
    const action = object(object(this.adapter.rules.actions)[id]);
    if (!Object.keys(action).length)
      throw new AdapterRuntimeError(
        "ADAPTER_ACTION_FAILED",
        `Action does not exist: ${id}`,
      );
    context.input = input;
    const actionContext = context as RuleObject;
    const tool =
      action.type === "process"
        ? await this.resolveTool(String(action.tool), actionContext, signal)
        : undefined;
    const environment = await this.environments.resolveDetailed(
      tool?.environmentId ?? "inherit",
      object(this.adapter.rules.environments),
      actionContext,
      signal,
    );
    if (tool) {
      const probed = await this.tools.probe(
        tool,
        object(this.adapter.rules.discoveries),
        actionContext,
        object(this.adapter.rules.parsers),
        environment.environment,
        this.adapter.bundle.id,
        signal,
      );
      const resolvedTool = {
        ...tool,
        ...(Object.keys(probed).length
          ? { probeResult: probed, probe: probed }
          : {}),
      };
      (context.tool as Record<string, RuleObject>)[tool.toolId] = {
        executable: resolvedTool.executable,
        argsPrefix: resolvedTool.argsPrefix,
        environmentId: resolvedTool.environmentId,
        discoveryId: resolvedTool.discoveryId,
        discoveredPath: resolvedTool.discoveredPath,
        probe: probed,
      };
      (context.discovery as Record<string, RuleObject>)[tool.discoveryId] = {
        path: tool.discoveredPath,
        candidateId: tool.candidateId,
        probe: probed,
      };
      (context.environment as Record<string, RuleObject>)[tool.environmentId] =
        {
          providerId: environment.providerId,
          strategy: environment.strategy,
          source: environment.source,
          variables: this.environmentSummary(environment.environment),
        };
      return this.executePlannedAction(
        id,
        action,
        actionContext,
        operation,
        signal,
        resolvedTool,
        environment.environment,
        dangerous,
        capabilityId,
        deadline,
        retainActionResult,
      );
    }
    return this.executePlannedAction(
      id,
      action,
      actionContext,
      operation,
      signal,
      undefined,
      environment.environment,
      dangerous,
      capabilityId,
      deadline,
      retainActionResult,
    );
  }

  private async executePlannedAction(
    id: string,
    action: RuleObject,
    actionContext: RuleObject,
    operation: OperationContext,
    signal: AbortSignal,
    tool: ResolvedTool | undefined,
    environment: NodeJS.ProcessEnv,
    dangerous: boolean,
    capabilityId: string,
    deadline: ExecutionDeadline,
    retainActionResult: boolean,
  ): Promise<RuleObject> {
    const plan = planLaunch(action, actionContext, tool, environment);
    const result = await abortAfter(
      signal,
      deadline.limit(plan.timeoutMs),
      async (actionSignal) => {
        if (plan.kind === "process") {
          const parser = plan.parserId
            ? object(object(this.adapter.rules.parsers)[plan.parserId])
            : undefined;
          const execution = await executeProcess(
            plan,
            parser,
            actionSignal,
            (event, data) => operation.emitEvent(event, data as Json),
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
          );
        return executeUnsupportedSerial();
      },
    );
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
      );
    }
    if (!retainActionResult) actionContext.result = previousResult;
    return result as RuleObject;
  }

  private async resolveTool(
    toolId: string,
    context: RuleObject,
    signal: AbortSignal,
  ): Promise<ResolvedTool> {
    const tool = await this.tools.resolve(
      toolId,
      object(this.adapter.rules.tools),
      object(this.adapter.rules.discoveries),
      context,
      object(this.adapter.rules.parsers),
      { probe: false, adapterId: this.adapter.bundle.id, signal },
    );
    return tool;
  }

  private environmentSummary(environment: NodeJS.ProcessEnv) {
    return Object.fromEntries(
      Object.entries(environment).map(([key, value]) => [
        key,
        value === undefined ? undefined : "[RESOLVED]",
      ]),
    );
  }

  private allowedRoots(operation: OperationContext) {
    return [
      operation.project?.root ?? process.cwd(),
      operation.stateRoot,
      tmpdir(),
      ...(operation.run ? [operation.run.dir] : []),
    ].map((value) => path.resolve(value));
  }
}
