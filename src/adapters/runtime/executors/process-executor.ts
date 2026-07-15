import { runProcess } from "../../../core/process/process-runner.js";
import { AdapterRuntimeError } from "../errors.js";
import { planLaunch, type ProcessLaunchPlan } from "../planning/launch-plan.js";
import { parseOutput } from "../rules/parser.js";
import { object, type RuleObject } from "../rules/template.js";

export interface ProcessExecutionResult {
  result: RuleObject;
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

export const executeProcess = async (
  plan: ProcessLaunchPlan,
  parser: RuleObject | undefined,
  signal: AbortSignal,
  emitProgress?: (event: string, data: RuleObject) => void,
): Promise<ProcessExecutionResult> => {
  const result = await runProcess({
    command: plan.executable,
    args: plan.args,
    cwd: plan.cwd,
    env: plan.env,
    signal,
    captureOutput: true,
    maxCaptureBytes: 1_048_576,
  });
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  if (!parser) {
    if (result.code !== 0)
      throw new AdapterRuntimeError(
        "ADAPTER_ACTION_FAILED",
        `Process exited with code ${String(result.code)}.`,
      );
    return { result: {}, stdout, stderr, exitCode: result.code };
  }
  const parsed = parseOutput(parser, stdout, stderr, result.code);
  for (const progress of parsed.progress)
    emitProgress?.(String(progress.event), progress.data);
  if (!parsed.success)
    throw new AdapterRuntimeError(
      "ADAPTER_PARSER_FAILED",
      parsed.error
        ? `Parser matched ${String(parsed.error.kind)}.`
        : parsed.requiredMissing.length
          ? `Required extracts missing: ${parsed.requiredMissing.join(", ")}`
          : `Process exited with code ${String(result.code)}.`,
      parsed.error?.retryable === true,
      Array.isArray(parsed.error?.recovery)
        ? parsed.error.recovery.map((item) => String(item))
        : [],
      { exitCode: result.code, signal: result.signal },
    );
  return { result: parsed.result, stdout, stderr, exitCode: result.code };
};

export const executeProcessAction = (
  action: RuleObject,
  context: RuleObject,
  tool: Parameters<typeof planLaunch>[2],
  environment: NodeJS.ProcessEnv,
  parser: RuleObject | undefined,
  signal: AbortSignal,
  emitProgress?: (event: string, data: RuleObject) => void,
) => {
  const plan = planLaunch(action, context, tool, environment);
  if (plan.kind !== "process")
    throw new AdapterRuntimeError(
      "ADAPTER_ACTION_FAILED",
      "Action is not a process action.",
    );
  return executeProcess(plan, parser, signal, emitProgress);
};
