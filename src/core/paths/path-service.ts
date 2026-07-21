import os from "node:os";
import path from "node:path";

export class PathService {
  constructor(
    readonly env: NodeJS.ProcessEnv = process.env,
    readonly platform = process.platform,
    readonly home = os.homedir(),
    readonly temp = os.tmpdir(),
  ) {}
  private persistentRoot() {
    return path.join(this.home, ".benchpilot");
  }
  globalConfig() {
    return path.join(this.persistentRoot(), "config.toml");
  }
  managedToolsRoot() {
    return path.join(this.persistentRoot(), "tools");
  }
  runtimeRoot() {
    return path.join(
      this.platform === "win32"
        ? this.env.TEMP || this.temp
        : this.env.XDG_RUNTIME_DIR || this.temp,
      "benchpilot",
      "locks",
    );
  }
  /**
   * Process-independent index for long-lived device sessions.  It deliberately
   * lives beside locks rather than under a project because another project must
   * still be able to locate and stop a session that owns the same device.
   */
  managedSessionsRoot() {
    return path.join(path.dirname(this.runtimeRoot()), "sessions");
  }
  lockGuardsRoot() {
    return path.join(path.dirname(this.runtimeRoot()), "guards");
  }
  lockRecoveryRoot() {
    return path.join(path.dirname(this.runtimeRoot()), "lock-recovery");
  }
  projectStateRoot(projectRoot: string) {
    return path.join(projectRoot, ".benchpilot", "state");
  }
  runsRoot(projectRoot: string) {
    return path.join(this.projectStateRoot(projectRoot), "runs");
  }
  approvalsRoot(projectRoot: string) {
    return path.join(this.projectStateRoot(projectRoot), "approvals");
  }
  approvalGuardsRoot(projectRoot: string) {
    return path.join(this.projectStateRoot(projectRoot), "approval-guards");
  }
  async project(start = process.cwd(), explicit?: string) {
    if (explicit)
      return {
        root: path.dirname(path.resolve(explicit)),
        config: path.resolve(explicit),
      };
    let directory = path.resolve(start);
    while (true) {
      const config = path.join(directory, "benchpilot.toml");
      try {
        await import("node:fs/promises").then(({ access }) => access(config));
        return { root: directory, config };
      } catch {}
      const parent = path.dirname(directory);
      if (parent === directory) return undefined;
      directory = parent;
    }
  }
}
