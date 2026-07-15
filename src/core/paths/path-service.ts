import os from "node:os";
import path from "node:path";

export class PathService {
  constructor(
    readonly env: NodeJS.ProcessEnv = process.env,
    readonly platform = process.platform,
    readonly home = os.homedir(),
    readonly temp = os.tmpdir(),
  ) {}
  get portable() {
    return this.env.BENCHPILOT_HOME;
  }
  private persistentRoot() {
    return path.join(this.home, ".benchpilot");
  }
  globalConfig() {
    if (this.portable) return path.join(this.portable, "config.toml");
    return path.join(this.persistentRoot(), "config.toml");
  }
  stateRoot() {
    if (this.portable) return path.join(this.portable, "state");
    return path.join(this.persistentRoot(), "state");
  }
  runtimeRoot() {
    if (this.portable) return path.join(this.portable, "runtime", "locks");
    return path.join(
      this.platform === "win32"
        ? this.env.TEMP || this.temp
        : this.env.XDG_RUNTIME_DIR || this.temp,
      "benchpilot",
      "locks",
    );
  }
  guardsRoot() {
    return path.join(path.dirname(this.runtimeRoot()), "guards");
  }
  runsRoot(projectKey: string) {
    return this.portable
      ? path.join(this.portable, "runs")
      : path.join(this.stateRoot(), "projects", projectKey, "runs");
  }
  approvalsRoot() {
    return path.join(this.stateRoot(), "approvals");
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
