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
  globalConfig() {
    if (this.portable) return path.join(this.portable, "config.toml");
    if (this.platform === "win32")
      return path.join(
        this.env.LOCALAPPDATA || this.home,
        "BenchPilot",
        "config.toml",
      );
    if (this.platform === "darwin")
      return path.join(
        this.home,
        "Library",
        "Application Support",
        "BenchPilot",
        "config.toml",
      );
    return path.join(
      this.env.XDG_CONFIG_HOME || path.join(this.home, ".config"),
      "benchpilot",
      "config.toml",
    );
  }
  stateRoot() {
    if (this.portable) return path.join(this.portable, "state");
    if (this.platform === "win32")
      return path.join(this.env.LOCALAPPDATA || this.temp, "BenchPilot");
    if (this.platform === "darwin")
      return path.join(
        this.home,
        "Library",
        "Application Support",
        "BenchPilot",
      );
    return path.join(
      this.env.XDG_STATE_HOME || path.join(this.home, ".local", "state"),
      "benchpilot",
    );
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
