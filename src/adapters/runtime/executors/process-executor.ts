import { runProcess } from "../../../core/process/process-runner.js";
import { AdapterRuntimeError } from "../errors.js";
import { planLaunch, type ProcessLaunchPlan } from "../planning/launch-plan.js";
import { castValue, type CastKind } from "../rules/cast.js";
import { parseOutput } from "../rules/parser.js";
import { object, type RuleObject } from "../rules/template.js";

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

  constructor(
    private readonly parser: RuleObject | undefined,
    private readonly emit?: (event: string, data: RuleObject) => void,
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
    if (tail.length > this.maxLineChars) {
      this.publishLine(source, tail.slice(-this.maxLineChars));
      return "";
    }
    return tail;
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
      for (const match of matches)
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
    }
  }
}

/** Mirrors raw process streams to RLog as complete text records without affecting parsing. */
class ProcessLogSink {
  private readonly stdout = new TextDecoder();
  private readonly stderr = new TextDecoder();
  private stdoutTail = "";
  private stderrTail = "";
  constructor(private readonly logger: ProcessLogger | undefined) {}
  write(source: "stdout" | "stderr", chunk: Buffer) {
    if (!this.logger) return;
    const decoder = source === "stdout" ? this.stdout : this.stderr;
    const current = source === "stdout" ? this.stdoutTail : this.stderrTail;
    const lines = `${current}${decoder.decode(chunk, { stream: true })}`.split(
      /\r?\n/,
    );
    const tail = lines.pop() ?? "";
    for (const line of lines) this.log(source, line);
    if (source === "stdout") this.stdoutTail = tail;
    else this.stderrTail = tail;
  }
  finish() {
    if (!this.logger) return;
    const stdout = `${this.stdoutTail}${this.stdout.decode()}`;
    const stderr = `${this.stderrTail}${this.stderr.decode()}`;
    if (stdout) this.log("stdout", stdout);
    if (stderr) this.log("stderr", stderr);
  }
  private log(source: "stdout" | "stderr", line: string) {
    if (source === "stdout") this.logger?.info(line);
    else this.logger?.warn(line);
  }
}

export const executeProcess = async (
  plan: ProcessLaunchPlan,
  parser: RuleObject | undefined,
  signal: AbortSignal,
  emitProgress?: (event: string, data: RuleObject) => void,
  logger?: ProcessLogger,
  onStarted?: () => void,
): Promise<ProcessExecutionResult> => {
  const streaming = new StreamingProgress(parser, emitProgress);
  const logs = new ProcessLogSink(logger);
  const result = await runProcess({
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
  streaming.finish();
  logs.finish();
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
      { exitCode: result.code, signal: result.signal },
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
) => {
  const plan = planLaunch(action, context, tool, environment);
  if (plan.kind !== "process")
    throw new AdapterRuntimeError(
      "ADAPTER_ACTION_FAILED",
      "Action is not a process action.",
    );
  return executeProcess(plan, parser, signal, emitProgress, logger, onStarted);
};
