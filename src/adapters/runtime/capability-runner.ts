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
import type { RuntimeAdapter } from "./types.js";
import { AdapterDataValidator } from "./validation/data-validator.js";

const abortAfter = async <T>(
  signal: AbortSignal,
  timeoutMs: number,
  execute: (signal: AbortSignal) => Promise<T>,
) => {
  const controller = new AbortController();
  const onAbort = () => controller.abort(signal.reason);
  signal.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(
    () => controller.abort(new Error("Adapter action timed out.")),
    timeoutMs,
  );
  try {
    return await execute(controller.signal);
  } finally {
    clearTimeout(timer);
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
    const context: RuleObject = {
      config: this.adapterConfig,
      device: this.deviceConfig,
      input: validatedInput,
      project: { root: operation.project?.root ?? process.cwd() },
      home: process.env.HOME ?? process.env.USERPROFILE ?? "",
      temp: tmpdir(),
      env: process.env,
      ...(operation.run
        ? { run: { dir: operation.run.dir, id: operation.run.id } }
        : {}),
      tool: {},
      discovery: {},
      environment: {},
      result: {},
    };
    const handler = String(capability.handler);
    const executeAction = (
      id: string,
      actionInput: RuleObject,
      signal: AbortSignal,
    ) => this.executeAction(id, actionInput, context, operation, signal);
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
        workflow,
        context,
        operation.signal,
        executeAction,
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
  ): Promise<RuleObject> {
    const action = object(object(this.adapter.rules.actions)[id]);
    if (!Object.keys(action).length)
      throw new AdapterRuntimeError(
        "ADAPTER_ACTION_FAILED",
        `Action does not exist: ${id}`,
      );
    const actionContext = { ...context, input };
    const tool =
      action.type === "process"
        ? await this.resolveTool(String(action.tool), actionContext)
        : undefined;
    const environment = await this.environments.resolve(
      tool?.environmentId ?? "inherit",
      object(this.adapter.rules.environments),
      actionContext,
      signal,
    );
    const plan = planLaunch(action, actionContext, tool, environment);
    const result = await abortAfter(
      signal,
      plan.timeoutMs,
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
          );
          return execution.result;
        }
        if (plan.kind === "copy")
          return await executeCopy(plan, this.allowedRoots(operation));
        return executeUnsupportedSerial();
      },
    );
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
    return result as RuleObject;
  }

  private async resolveTool(
    toolId: string,
    context: RuleObject,
  ): Promise<ResolvedTool> {
    const tool = await this.tools.resolve(
      toolId,
      object(this.adapter.rules.tools),
      object(this.adapter.rules.discoveries),
      context,
      object(this.adapter.rules.parsers),
    );
    return tool;
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
