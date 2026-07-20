import { AdapterRuntimeError } from "../errors.js";
import { durationMs } from "../planning/launch-plan.js";
import { planWorkflowStep } from "../planning/workflow-planner.js";
import { object, type RuleObject } from "../rules/template.js";

const throwIfControlled = (
  signal: AbortSignal,
  controller: AbortController,
) => {
  if (signal.aborted) throw signal.reason ?? new Error("Workflow aborted.");
  if (controller.signal.aborted)
    throw controller.signal.reason ?? new Error("Workflow aborted.");
};

const isControlFlowError = (error: unknown) => {
  const code =
    error instanceof AdapterRuntimeError
      ? error.code
      : error && typeof error === "object"
        ? String(
            (error as { code?: unknown; kind?: unknown }).code ??
              (error as { kind?: unknown }).kind ??
              "",
          )
        : "";
  return code.endsWith("_TIMEOUT") || code === "LOCK_OWNERSHIP_LOST";
};

export const executeWorkflow = async (
  workflow: RuleObject,
  context: RuleObject,
  signal: AbortSignal,
  executeAction: (
    id: string,
    input: RuleObject,
    signal: AbortSignal,
  ) => Promise<RuleObject>,
  emit?: (event: string, data: RuleObject) => void,
  effectiveTimeoutMs?: number,
) => {
  const controller = new AbortController();
  const onAbort = () => controller.abort(signal.reason);
  signal.addEventListener("abort", onAbort, { once: true });
  const timeoutMs =
    effectiveTimeoutMs === undefined
      ? durationMs(workflow.timeout)
      : effectiveTimeoutMs;
  if (effectiveTimeoutMs !== undefined && effectiveTimeoutMs <= 0)
    throw new AdapterRuntimeError(
      "ADAPTER_ACTION_TIMEOUT",
      "Capability deadline has expired.",
      true,
    );
  const timer =
    timeoutMs !== undefined && timeoutMs > 0
      ? setTimeout(
          () =>
            controller.abort(
              new AdapterRuntimeError(
                "ADAPTER_WORKFLOW_TIMEOUT",
                "Workflow timed out.",
                true,
                [
                  "Retry the operation.",
                  "Increase the operation timeout if the device or tool is slow.",
                ],
              ),
            ),
          timeoutMs,
        )
      : undefined;
  const results: RuleObject[] = [];
  try {
    const workflowId = String(workflow.id ?? "workflow");
    const rawSteps = Array.isArray(workflow.steps) ? workflow.steps : [];
    const eventDataFor = (rawStep: unknown) => {
      const raw = object(rawStep);
      const rawLabel = object(raw.label);
      const label =
        typeof rawLabel.key === "string" &&
        typeof rawLabel.fallback === "string"
          ? { key: rawLabel.key, fallback: rawLabel.fallback }
          : undefined;
      return {
        workflowId,
        stepId: String(raw.id),
        displayId:
          typeof raw.progress_id === "string"
            ? raw.progress_id
            : String(raw.id),
        actionId: String(raw.uses).replace(/^action:/, ""),
        ...(label ? { label } : {}),
      };
    };
    emit?.("adapter.workflow.started", {
      workflowId,
      steps: rawSteps.map(eventDataFor),
    });
    for (const rawStep of rawSteps) {
      throwIfControlled(signal, controller);
      const raw = object(rawStep);
      const eventData = eventDataFor(rawStep);
      const { actionId, stepId } = eventData;
      // Workflow conditions see the original capability input. Step inputs
      // are rendered separately and exposed through `context.step.input`.
      const step = planWorkflowStep(rawStep, context, true);
      if (!step) {
        emit?.("adapter.workflow.step.skipped", eventData);
        continue;
      }
      emit?.("adapter.workflow.step.started", eventData);
      context.step = {
        workflowId,
        id: step.id,
        displayId: eventData.displayId,
        action: actionId,
        input: step.with,
      };
      try {
        const result = await executeAction(
          actionId,
          object(step.with),
          controller.signal,
        );
        throwIfControlled(signal, controller);
        results.push({ id: step.id, ok: true, result });
        context.step = {
          workflowId,
          id: step.id,
          displayId: eventData.displayId,
          action: actionId,
          input: step.with,
          ok: true,
          result,
        };
        context.result = {
          ...object(context.result),
          [String(step.id)]: result,
        };
        emit?.("adapter.workflow.step.completed", eventData);
      } catch (error) {
        throwIfControlled(signal, controller);
        if (isControlFlowError(error)) throw error;
        results.push({ id: step.id, ok: false });
        const runtime =
          error instanceof AdapterRuntimeError ? error : undefined;
        context.step = {
          workflowId,
          id: step.id,
          displayId: eventData.displayId,
          action: actionId,
          input: step.with,
          ok: false,
          error: {
            kind: runtime?.code ?? "ADAPTER_ACTION_FAILED",
            retryable: runtime?.retryable === true,
          },
        };
        context.result = {
          ...object(context.result),
          [String(step.id)]: context.step,
        };
        emit?.("adapter.workflow.step.failed", eventData);
        if (
          step.continue_on_error === true ||
          workflow.stop_on_failure === false
        )
          continue;
        throw error;
      }
    }
    throwIfControlled(signal, controller);
    emit?.("adapter.workflow.completed", { workflowId });
    return { steps: results };
  } finally {
    if (timer) clearTimeout(timer);
    signal.removeEventListener("abort", onAbort);
  }
};
