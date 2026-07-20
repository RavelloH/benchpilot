import { runProcess } from "../../../core/process/process-runner.js";
import { AdapterRuntimeError } from "../errors.js";
import { planLaunch, type ProcessLaunchPlan } from "../planning/launch-plan.js";
import { castValue, type CastKind } from "../rules/cast.js";
import { parseOutput, shouldEmitProgress } from "../rules/parser.js";
import { object, type RuleObject } from "../rules/template.js";
import type { SecretRedactor } from "../validation/secret-redactor.js";

interface ProcessLogger {
  info(...args: unknown[]): unknown;
  warn(...args: unknown[]): unknown;
}

export interface ProcessExecutionResult {
  result: RuleObject;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
}

class StreamingProgress {
  private readonly stdout = new TextDecoder();
  private readonly stderr = new TextDecoder();
  private stdoutTail = "";
  private stderrTail = "";
  private readonly maxLineChars = 1024 * 1024;
  private readonly progressSamples = new Map<string, number>();
  private finished = false;

  constructor(
    private readonly parser: RuleObject | undefined,
    private readonly emit?: (event: string, data: RuleObject) => void,
    private readonly redactor?: SecretRedactor,
  ) {}

  stdoutChunk(chunk: Buffer) {
    this.stdoutTail = this.consume(
      "stdout",
      `${this.stdoutTail}${this.stdout.decode(chunk, { stream: true })}`,
    );
  }

  stderrChunk(chunk: Buffer) {
    this.stderrTail = this.consume(
      "stderr",
      `${this.stderrTail}${this.stderr.decode(chunk, { stream: true })}`,
    );
  }

  finish() {
    if (this.finished) return;
    this.finished = true;
    this.stdoutTail = this.consume(
      "stdout",
      `${this.stdoutTail}${this.stdout.decode()}`,
      true,
    );
    this.stderrTail = this.consume(
      "stderr",
      `${this.stderrTail}${this.stderr.decode()}`,
      true,
    );
  }

  private consume(source: "stdout" | "stderr", value: string, flush = false) {
    const lines = value.split(/\r?\n/);
    const tail = flush ? "" : (lines.pop() ?? "");
    for (const line of lines) this.publishLine(source, line);
    if (flush && tail) this.publishLine(source, tail);
    // Do not scan a logical line until it is complete. Keeping only its tail
    // bounds memory without causing a progress rule to fire twice for a line
    // split across large chunks.
    return tail.length > this.maxLineChars
      ? tail.slice(-this.maxLineChars)
      : tail;
  }

  private publishLine(source: "stdout" | "stderr", line: string) {
    if (!this.parser || !this.emit) return;
    const normalize = (value: string) =>
      this.parser?.strip_ansi === true
        ? value.replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, "")
        : value;
    const text = normalize(line);
    for (const raw of Array.isArray(this.parser.progress)
      ? this.parser.progress
      : []) {
      const rule = object(raw);
      if (rule.source === "stderr" && source !== "stderr") continue;
      if (rule.source === "stdout" && source !== "stdout") continue;
      let matches: RegExpMatchArray[];
      try {
        matches = Array.from(
          text.matchAll(new RegExp(String(rule.pattern), "g")),
        );
      } catch {
        continue;
      }
      for (const match of matches) {
        const label = object(rule.label);
        const data = {
          ...Object.fromEntries(
            Object.entries(object(rule.fields)).map(([name, kind]) => {
              const rawValue = match.groups?.[name] ?? "";
              const value = castValue(rawValue, kind as CastKind);
              return [name, this.redactor?.redactValue(value) ?? value];
            }),
          ),
          ...(typeof label.key === "string" &&
          typeof label.fallback === "string"
            ? { label: { key: label.key, fallback: label.fallback } }
            : {}),
          ...(rule.state === "running" || rule.state === "completed"
            ? { state: rule.state }
            : {}),
          ...(rule.reentrant === true ? { reentrant: true } : {}),
          ...(Object.keys(object(rule.cycle)).length
            ? { cycle: object(rule.cycle) }
            : {}),
          ...(rule.cycle_complete === true ? { cycleComplete: true } : {}),
        };
        if (shouldEmitProgress(rule, data, this.progressSamples))
          this.emit(String(rule.event), data);
      }
    }
  }
}

/** Mirrors raw process streams to RLog as complete text records without affecting parsing. */
class ProcessLogSink {
  private readonly stdout = new TextDecoder();
  private readonly stderr = new TextDecoder();
  private stdoutTail = "";
  private stderrTail = "";
  private readonly maxLineChars = 1024 * 1024;
  private finished = false;
  constructor(
    private readonly logger: ProcessLogger | undefined,
    private readonly redactor?: SecretRedactor,
  ) {}
  write(source: "stdout" | "stderr", chunk: Buffer) {
    if (!this.logger) return;
    const decoder = source === "stdout" ? this.stdout : this.stderr;
    const current = source === "stdout" ? this.stdoutTail : this.stderrTail;
    const lines = `${current}${decoder.decode(chunk, { stream: true })}`.split(
      /\r?\n/,
    );
    const tail = lines.pop() ?? "";
    for (const line of lines) this.log(source, line);
    const bounded =
      tail.length > this.maxLineChars ? tail.slice(-this.maxLineChars) : tail;
    if (source === "stdout") this.stdoutTail = bounded;
    else this.stderrTail = bounded;
  }
  finish() {
    if (this.finished) return;
    this.finished = true;
    if (!this.logger) return;
    const stdout = `${this.stdoutTail}${this.stdout.decode()}`;
    const stderr = `${this.stderrTail}${this.stderr.decode()}`;
    if (stdout) this.log("stdout", stdout);
    if (stderr) this.log("stderr", stderr);
  }
  private log(source: "stdout" | "stderr", line: string) {
    const redacted = this.redactor?.redactText(line) ?? line;
    if (source === "stdout") this.logger?.info(redacted);
    else this.logger?.warn(redacted);
  }
}

export const executeProcess = async (
  plan: ProcessLaunchPlan,
  parser: RuleObject | undefined,
  signal: AbortSignal,
  emitProgress?: (event: string, data: RuleObject) => void,
  logger?: ProcessLogger,
  onStarted?: () => void,
  redactor?: SecretRedactor,
): Promise<ProcessExecutionResult> => {
  const streaming = new StreamingProgress(parser, emitProgress, redactor);
  const logs = new ProcessLogSink(logger, redactor);
  let result: Awaited<ReturnType<typeof runProcess>>;
  try {
    result = await runProcess({
      command: plan.executable,
      args: plan.args,
      cwd: plan.cwd,
      env: plan.env,
      signal,
      captureOutput: true,
      maxCaptureBytes: 4 * 1024 * 1024,
      onStdout: (chunk) => {
        streaming.stdoutChunk(chunk);
        logs.write("stdout", chunk);
      },
      onStderr: (chunk) => {
        streaming.stderrChunk(chunk);
        logs.write("stderr", chunk);
      },
      onStarted,
    });
  } finally {
    // Error, abort and spawn-failure paths may still contain a final partial
    // UTF-8 line that must reach parsers/progress and the operation RLog.
    streaming.finish();
    logs.finish();
  }
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  const stdoutTruncated = result.stdoutTruncated === true;
  const stderrTruncated = result.stderrTruncated === true;
  if (!parser) {
    if (result.code !== 0)
      throw new AdapterRuntimeError(
        "ADAPTER_ACTION_FAILED",
        `Process exited with code ${String(result.code)}.`,
      );
    return {
      result: {},
      stdout,
      stderr,
      exitCode: result.code,
      stdoutTruncated,
      stderrTruncated,
    };
  }
  if (
    (stdoutTruncated || stderrTruncated) &&
    (Array.isArray(parser.extract) ? parser.extract : []).some(
      (rule) => object(rule).type === "json-pointer",
    )
  )
    throw new AdapterRuntimeError(
      "ADAPTER_PARSER_FAILED",
      "JSON parser output exceeded the capture limit.",
      false,
      ["Reduce tool output or emit the machine-readable result separately."],
      { stdoutTruncated, stderrTruncated },
    );
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
      {
        exitCode: result.code,
        signal: result.signal,
        ...(parsed.error ? { parserKind: String(parsed.error.kind) } : {}),
        ...(parsed.error &&
        typeof object(parsed.error.message).key === "string" &&
        typeof object(parsed.error.message).fallback === "string"
          ? { messageRef: object(parsed.error.message) }
          : {}),
      },
    );
  return {
    result: parsed.result,
    stdout,
    stderr,
    exitCode: result.code,
    stdoutTruncated,
    stderrTruncated,
  };
};

export const executeProcessAction = (
  action: RuleObject,
  context: RuleObject,
  tool: Parameters<typeof planLaunch>[2],
  environment: NodeJS.ProcessEnv,
  parser: RuleObject | undefined,
  signal: AbortSignal,
  emitProgress?: (event: string, data: RuleObject) => void,
  logger?: ProcessLogger,
  onStarted?: () => void,
  redactor?: SecretRedactor,
) => {
  const plan = planLaunch(action, context, tool, environment);
  if (plan.kind !== "process")
    throw new AdapterRuntimeError(
      "ADAPTER_ACTION_FAILED",
      "Action is not a process action.",
    );
  return executeProcess(
    plan,
    parser,
    signal,
    emitProgress,
    logger,
    onStarted,
    redactor,
  );
};
