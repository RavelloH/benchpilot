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
    const timer = setTimeout(resolve, ms);
    timer.unref();
  });

const runTaskkill = (args: string[]) =>
  new Promise<void>((resolve) => {
    const taskkill = spawn("taskkill", args, {
      shell: false,
      windowsHide: true,
      stdio: "ignore",
    });
    taskkill.once("error", () => resolve());
    taskkill.once("close", () => resolve());
  });

async function terminateTree(
  child: ChildProcess,
  force: boolean,
  killTree: boolean,
) {
  if (!child.pid) return;
  if (process.platform === "win32") {
    await runTaskkill([
      "/PID",
      String(child.pid),
      "/T",
      ...(force ? ["/F"] : []),
    ]);
    return;
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
  // `exitCode` is set before `close`. Capture this from spawn time so an
  // abort never resolves before the original child's streams are closed.
  const closed = new Promise<void>((resolve) => child.once("close", resolve));
  options.signal.removeEventListener("abort", onAbortDuringLaunch);
  let stdout = "";
  let stderr = "";
  let outputTruncated = false;
  const maxCaptureBytes = options.maxCaptureBytes ?? 1_048_576;
  const append = (current: string, chunk: Buffer) => {
    if (!options.captureOutput || outputTruncated) return current;
    const remaining = maxCaptureBytes - Buffer.byteLength(current);
    if (remaining <= 0) {
      outputTruncated = true;
      return current;
    }
    const accepted = chunk.subarray(0, remaining).toString("utf8");
    if (chunk.length > remaining) outputTruncated = true;
    return current + accepted;
  };
  child.stdout?.on("data", (chunk: Buffer) => {
    options.stdout?.write(chunk);
    options.onStdout?.(chunk);
    stdout = append(stdout, chunk);
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    options.stderr?.write(chunk);
    options.onStderr?.(chunk);
    stderr = append(stderr, chunk);
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
      await terminateTree(child, false, killTree);
      const gracefullyClosed = await Promise.race([
        closed.then(() => true),
        delay(options.gracefulKillMs ?? 2_000).then(() => false),
      ]);
      if (!gracefullyClosed) {
        await terminateTree(child, true, killTree);
        const ended = await Promise.race([
          closed.then(() => true),
          delay(options.forceKillMs ?? 2_000).then(() => false),
        ]);
        if (!ended) {
          state = "cleanup-timeout";
          throw new BenchPilotError(
            "PROCESS_CLEANUP_TIMEOUT",
            5,
            `Process tree did not exit: ${options.command}`,
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
      ...(options.captureOutput ? { stdout, stderr, outputTruncated } : {}),
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
