import { AdapterRuntimeError } from "../errors.js";
import { durationMs } from "../planning/launch-plan.js";
import { planWorkflow } from "../planning/workflow-planner.js";
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
    emit?.("adapter.workflow.started", {});
    for (const step of planWorkflow(workflow, context, true)) {
      if (controller.signal.aborted)
        throw new AdapterRuntimeError(
          "ADAPTER_ACTION_FAILED",
          "Workflow timed out or was aborted.",
        );
      const actionId = String(step.uses).replace(/^action:/, "");
      emit?.("adapter.workflow.step.started", { id: step.id, actionId });
      try {
        const result = await executeAction(
          actionId,
          object(step.with),
          controller.signal,
        );
        results.push({ id: step.id, ok: true, result });
        context.step = { id: step.id, result };
        context.result = {
          ...object(context.result),
          [String(step.id)]: result,
        };
        emit?.("adapter.workflow.step.completed", { id: step.id });
      } catch (error) {
        results.push({ id: step.id, ok: false });
        emit?.("adapter.workflow.step.failed", { id: step.id });
        if (
          step.continue_on_error === true ||
          workflow.stop_on_failure === false
        )
          continue;
        throw error;
      }
    }
    emit?.("adapter.workflow.completed", {});
    return { steps: results };
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", onAbort);
  }
};
