import { spawn, type ChildProcess } from "node:child_process";
import type { Writable } from "node:stream";
import { BenchPilotError } from "../errors/benchpilot-error.js";

export interface ProcessRunOptions {
  command: string;
  args: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  signal: AbortSignal;
  stdout?: Writable;
  stderr?: Writable;
  onStdout?: (chunk: Buffer) => void;
  onStderr?: (chunk: Buffer) => void;
  onStarted?: () => void;
  gracefulKillMs?: number;
  forceKillMs?: number;
  killTree?: boolean;
  captureOutput?: boolean;
  maxCaptureBytes?: number;
}

export interface ProcessRunResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  durationMs: number;
  stdout?: string;
  stderr?: string;
  outputTruncated?: boolean;
  stdoutTruncated?: boolean;
  stderrTruncated?: boolean;
}

export interface StartedProcess {
  readonly child: ChildProcess;
  readonly result: Promise<ProcessRunResult>;
  readonly state: ProcessState;
  isRunning(): boolean;
  stop(): Promise<void>;
}

export type ProcessState =
  "running" | "exited" | "stopping" | "stopped" | "cleanup-timeout";

const delay = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

const runTaskkill = (args: string[]) =>
  new Promise<{
    code: number | null;
    error?: Error;
    output: string;
  }>((resolve) => {
    const taskkill = spawn("taskkill", args, {
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    const capture = (chunk: Buffer) => {
      output += String(chunk);
    };
    taskkill.stdout?.on("data", capture);
    taskkill.stderr?.on("data", capture);
    taskkill.once("error", (error) => resolve({ code: null, error, output }));
    taskkill.once("close", (code) => resolve({ code, output }));
  });

function processGroupExists(pgid: number) {
  try {
    process.kill(-pgid, 0);
    return true;
  } catch (error: unknown) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

async function waitFor(
  check: () => boolean,
  timeoutMs: number,
  intervalMs = 20,
) {
  const deadline = Date.now() + timeoutMs;
  while (check()) {
    if (Date.now() >= deadline) return false;
    await delay(Math.min(intervalMs, Math.max(1, deadline - Date.now())));
  }
  return true;
}

interface TerminationAttempt {
  confirmed: boolean;
  taskkill?: {
    force: boolean;
    code: number | null;
    output: string;
    cause?: string;
  };
}

async function terminateTree(
  child: ChildProcess,
  force: boolean,
  killTree: boolean,
): Promise<TerminationAttempt> {
  if (!child.pid) return { confirmed: true };
  if (process.platform === "win32") {
    const result = await runTaskkill([
      "/PID",
      String(child.pid),
      "/T",
      ...(force ? ["/F"] : []),
    ]);
    const missing =
      result.code !== 0 && /not found|not exist/i.test(result.output);
    return {
      confirmed: result.code === 0 || missing,
      taskkill: {
        force,
        code: result.code,
        output: result.output,
        cause: result.error?.message,
      },
    };
  }
  try {
    if (killTree) process.kill(-child.pid, force ? "SIGKILL" : "SIGTERM");
    else child.kill(force ? "SIGKILL" : "SIGTERM");
  } catch (error: unknown) {
    if (
      !["ESRCH", "EPERM"].includes((error as NodeJS.ErrnoException).code || "")
    )
      throw error;
  }
  return { confirmed: true };
}

/**
 * Starts an executable without a shell. Its stop method is idempotent and does
 * not settle until its process tree has exited.
 */
export function startProcess(options: ProcessRunOptions): StartedProcess {
  if (options.signal.aborted)
    throw options.signal.reason ?? new Error("Process aborted before launch.");

  let abortedDuringLaunch = false;
  const onAbortDuringLaunch = () => {
    abortedDuringLaunch = true;
  };
  options.signal.addEventListener("abort", onAbortDuringLaunch, { once: true });
  if (options.signal.aborted) {
    options.signal.removeEventListener("abort", onAbortDuringLaunch);
    throw options.signal.reason ?? new Error("Process aborted before launch.");
  }

  const started = Date.now();
  const child = spawn(options.command, options.args, {
    cwd: options.cwd,
    env: options.env,
    shell: false,
    windowsHide: true,
    detached: process.platform !== "win32" && (options.killTree ?? true),
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.once("spawn", () => options.onStarted?.());
  // `exitCode` is set before `close`. Capture this from spawn time so an
  // abort never resolves before the original child's streams are closed.
  const closed = new Promise<void>((resolve) => child.once("close", resolve));
  options.signal.removeEventListener("abort", onAbortDuringLaunch);
  const maxCaptureBytes = options.maxCaptureBytes ?? 4 * 1024 * 1024;
  class BoundedCapture {
    private head = Buffer.alloc(0);
    private tail = Buffer.alloc(0);
    truncated = false;
    constructor(private readonly limit: number) {}
    append(chunk: Buffer) {
      if (!options.captureOutput) return;
      const headLimit = Math.min(
        1024 * 1024,
        Math.max(0, Math.floor(this.limit / 4)),
      );
      const tailLimit = Math.max(0, this.limit - headLimit);
      let rest = chunk;
      if (this.head.length < headLimit) {
        const consumed = Math.min(headLimit - this.head.length, rest.length);
        this.head = Buffer.concat([this.head, rest.subarray(0, consumed)]);
        rest = rest.subarray(consumed);
      }
      if (!rest.length) return;
      const combined = Buffer.concat([this.tail, rest]);
      if (combined.length > tailLimit) {
        this.tail = combined.subarray(Math.max(0, combined.length - tailLimit));
        this.truncated = true;
      } else this.tail = combined;
    }
    text() {
      return Buffer.concat([this.head, this.tail]).toString("utf8");
    }
  }
  const stdoutCapture = new BoundedCapture(maxCaptureBytes);
  const stderrCapture = new BoundedCapture(maxCaptureBytes);
  child.stdout?.on("data", (chunk: Buffer) => {
    options.stdout?.write(chunk);
    options.onStdout?.(chunk);
    stdoutCapture.append(chunk);
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    options.stderr?.write(chunk);
    options.onStderr?.(chunk);
    stderrCapture.append(chunk);
  });

  let settle!: (value: ProcessRunResult) => void;
  let reject!: (reason: unknown) => void;
  const result = new Promise<ProcessRunResult>((resolve, rejectResult) => {
    settle = resolve;
    reject = rejectResult;
  });
  let stopped: Promise<void> | undefined;
  let aborting = false;
  let settled = false;
  let state: ProcessState = "running";
  const removeAbortListener = () =>
    options.signal.removeEventListener("abort", onAbort);
  const finish = (value: ProcessRunResult) => {
    if (settled) return;
    settled = true;
    removeAbortListener();
    settle(value);
  };
  const fail = (error: unknown) => {
    if (settled) return;
    settled = true;
    removeAbortListener();
    reject(error);
  };
  const stop = () => {
    if (stopped) return stopped;
    if (state === "exited" || state === "stopped") return Promise.resolve();
    stopped = (async () => {
      state = "stopping";
      const killTree = options.killTree ?? true;
      const taskkillAttempts: NonNullable<TerminationAttempt["taskkill"]>[] =
        [];
      const gracefulAttempt = await terminateTree(child, false, killTree);
      if (gracefulAttempt.taskkill)
        taskkillAttempts.push(gracefulAttempt.taskkill);
      const gracefulKillMs = options.gracefulKillMs ?? 2_000;
      const forceKillMs = options.forceKillMs ?? 2_000;
      const group =
        killTree && process.platform !== "win32" ? child.pid : undefined;
      const gracefulEnded =
        gracefulAttempt.confirmed &&
        (group
          ? await waitFor(() => processGroupExists(group), gracefulKillMs)
          : await Promise.race([
              closed.then(() => true),
              delay(gracefulKillMs).then(() => false),
            ]));
      if (!gracefulEnded) {
        const forceAttempt = await terminateTree(child, true, killTree);
        if (forceAttempt.taskkill) taskkillAttempts.push(forceAttempt.taskkill);
        const ended =
          forceAttempt.confirmed &&
          (group
            ? await waitFor(() => processGroupExists(group), forceKillMs)
            : await Promise.race([
                closed.then(() => true),
                delay(forceKillMs).then(() => false),
              ]));
        if (!ended) {
          state = "cleanup-timeout";
          throw new BenchPilotError(
            "PROCESS_CLEANUP_TIMEOUT",
            5,
            `Process tree did not exit: ${options.command}`,
            false,
            undefined,
            [],
            taskkillAttempts.length ? { taskkillAttempts } : undefined,
          );
        }
      }
      state = "stopped";
    })();
    return stopped;
  };
  const onAbort = () => {
    if (aborting || settled) return;
    aborting = true;
    void stop().then(
      () => fail(options.signal.reason ?? new Error("Process aborted.")),
      (error) => fail(error),
    );
  };
  options.signal.addEventListener("abort", onAbort, { once: true });
  child.once("error", (error) => fail(error));
  child.once("close", (code, signal) => {
    if (aborting) return;
    state = "exited";
    finish({
      code,
      signal,
      durationMs: Date.now() - started,
      ...(options.captureOutput
        ? {
            stdout: stdoutCapture.text(),
            stderr: stderrCapture.text(),
            stdoutTruncated: stdoutCapture.truncated,
            stderrTruncated: stderrCapture.truncated,
            outputTruncated: stdoutCapture.truncated || stderrCapture.truncated,
          }
        : {}),
    });
  });
  // Covers an abort after listener registration but before/while spawn returns.
  if (abortedDuringLaunch || options.signal.aborted) onAbort();
  return {
    child,
    result,
    get state() {
      return state;
    },
    isRunning() {
      return state === "running" || state === "stopping";
    },
    stop,
  };
}

/** Runs an executable and waits for its complete process tree on abort. */
export async function runProcess(
  options: ProcessRunOptions,
): Promise<ProcessRunResult> {
  return startProcess(options).result;
}
