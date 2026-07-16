import { AdapterRuntimeError } from "../errors.js";
import { durationMs } from "../planning/launch-plan.js";
import { planWorkflowStep } from "../planning/workflow-planner.js";
import { object, type RuleObject } from "../rules/template.js";

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
) => {
  const controller = new AbortController();
  const onAbort = () => controller.abort(signal.reason);
  signal.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(
    () => controller.abort(new Error("Workflow timed out.")),
    durationMs(workflow.timeout),
  );
  const results: RuleObject[] = [];
  try {
    const workflowId = String(workflow.id ?? "workflow");
    emit?.("adapter.workflow.started", { workflowId });
    for (const rawStep of Array.isArray(workflow.steps) ? workflow.steps : []) {
      const raw = object(rawStep);
      const actionId = String(raw.uses).replace(/^action:/, "");
      const stepId = String(raw.id);
      const step = planWorkflowStep(rawStep, context, true);
      if (!step) {
        emit?.("adapter.workflow.step.skipped", {
          workflowId,
          stepId,
          actionId,
        });
        continue;
      }
      if (controller.signal.aborted)
        throw new AdapterRuntimeError(
          "ADAPTER_WORKFLOW_TIMEOUT",
          "Workflow timed out or was aborted.",
          true,
          [
            "Retry the operation.",
            "Increase the operation timeout if the device or tool is slow.",
          ],
        );
      emit?.("adapter.workflow.step.started", { workflowId, stepId, actionId });
      try {
        const result = await executeAction(
          actionId,
          object(step.with),
          controller.signal,
        );
        results.push({ id: step.id, ok: true, result });
        context.step = { id: step.id, action: actionId, ok: true, result };
        context.result = {
          ...object(context.result),
          [String(step.id)]: result,
        };
        emit?.("adapter.workflow.step.completed", {
          workflowId,
          stepId,
          actionId,
        });
      } catch (error) {
        results.push({ id: step.id, ok: false });
        const runtime =
          error instanceof AdapterRuntimeError ? error : undefined;
        context.step = {
          id: step.id,
          action: actionId,
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
        emit?.("adapter.workflow.step.failed", {
          workflowId,
          stepId,
          actionId,
        });
        if (
          step.continue_on_error === true ||
          workflow.stop_on_failure === false
        )
          continue;
        throw error;
      }
    }
    emit?.("adapter.workflow.completed", { workflowId });
    return { steps: results };
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", onAbort);
  }
};
