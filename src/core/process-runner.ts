import { spawn } from "node:child_process";

export interface ProcessRunOptions {
  command: string;
  args: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  signal: AbortSignal;
  gracefulKillMs?: number;
  forceKillMs?: number;
}

export interface ProcessRunResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}

/** Runs an executable without a shell and terminates it when its operation aborts. */
export async function runProcess(
  options: ProcessRunOptions,
): Promise<ProcessRunResult> {
  if (options.signal.aborted)
    throw options.signal.reason ?? new Error("Process aborted before launch.");
  return new Promise((resolve, reject) => {
    const child = spawn(options.command, options.args, {
      cwd: options.cwd,
      env: options.env,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let aborted = false;
    let forceTimer: NodeJS.Timeout | undefined;
    const onAbort = () => {
      aborted = true;
      child.kill("SIGTERM");
      forceTimer = setTimeout(() => {
        if (process.platform === "win32" && child.pid)
          spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
            shell: false,
            windowsHide: true,
            stdio: "ignore",
          });
        else child.kill("SIGKILL");
      }, options.forceKillMs ?? 2_000);
      forceTimer.unref();
    };
    child.stdout?.setEncoding("utf8").on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr?.setEncoding("utf8").on("data", (chunk: string) => {
      stderr += chunk;
    });
    options.signal.addEventListener("abort", onAbort, { once: true });
    child.once("error", (error) => {
      options.signal.removeEventListener("abort", onAbort);
      if (forceTimer) clearTimeout(forceTimer);
      reject(error);
    });
    child.once("close", (code, signal) => {
      options.signal.removeEventListener("abort", onAbort);
      if (forceTimer) clearTimeout(forceTimer);
      if (aborted)
        reject(options.signal.reason ?? new Error("Process aborted."));
      else resolve({ code, signal, stdout, stderr });
    });
  });
}
