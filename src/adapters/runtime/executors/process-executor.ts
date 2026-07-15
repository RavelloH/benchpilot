import { runProcess } from "../../../core/process/process-runner.js";
import { AdapterRuntimeError } from "../errors.js";
import { planLaunch, type ProcessLaunchPlan } from "../planning/launch-plan.js";
import { castValue, type CastKind } from "../rules/cast.js";
import { parseOutput } from "../rules/parser.js";
import { object, type RuleObject } from "../rules/template.js";

export interface ProcessExecutionResult {
  result: RuleObject;
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

class StreamingProgress {
  private readonly stdout = new TextDecoder();
  private readonly stderr = new TextDecoder();
  private stdoutText = "";
  private stderrText = "";
  private emitted = new Map<number, number>();

  constructor(
    private readonly parser: RuleObject | undefined,
    private readonly emit?: (event: string, data: RuleObject) => void,
  ) {}

  stdoutChunk(chunk: Buffer) {
    this.stdoutText += this.stdout.decode(chunk, { stream: true });
    this.publish();
  }

  stderrChunk(chunk: Buffer) {
    this.stderrText += this.stderr.decode(chunk, { stream: true });
    this.publish();
  }

  finish() {
    this.stdoutText += this.stdout.decode();
    this.stderrText += this.stderr.decode();
    this.publish();
  }

  private publish() {
    if (!this.parser || !this.emit) return;
    const normalize = (value: string) =>
      this.parser?.strip_ansi === true
        ? value.replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, "")
        : value;
    const stdout = normalize(this.stdoutText);
    const stderr = normalize(this.stderrText);
    for (const [index, raw] of (Array.isArray(this.parser.progress)
      ? this.parser.progress
      : []
    ).entries()) {
      const rule = object(raw);
      const text =
        rule.source === "stderr"
          ? stderr
          : rule.source === "both"
            ? `${stdout}\n${stderr}`
            : stdout;
      let matches: RegExpMatchArray[];
      try {
        matches = Array.from(
          text.matchAll(new RegExp(String(rule.pattern), "g")),
        );
      } catch {
        continue;
      }
      const sent = this.emitted.get(index) ?? 0;
      for (const match of matches.slice(sent))
        this.emit(
          String(rule.event),
          Object.fromEntries(
            Object.entries(object(rule.fields)).map(([name, kind]) => {
              const rawValue = match.groups?.[name] ?? "";
              const value = castValue(rawValue, kind as CastKind);
              return [name, value];
            }),
          ),
        );
      this.emitted.set(index, matches.length);
    }
  }
}

export const executeProcess = async (
  plan: ProcessLaunchPlan,
  parser: RuleObject | undefined,
  signal: AbortSignal,
  emitProgress?: (event: string, data: RuleObject) => void,
): Promise<ProcessExecutionResult> => {
  const streaming = new StreamingProgress(parser, emitProgress);
  const result = await runProcess({
    command: plan.executable,
    args: plan.args,
    cwd: plan.cwd,
    env: plan.env,
    signal,
    captureOutput: true,
    maxCaptureBytes: 1_048_576,
    onStdout: (chunk) => streaming.stdoutChunk(chunk),
    onStderr: (chunk) => streaming.stderrChunk(chunk),
  });
  streaming.finish();
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
