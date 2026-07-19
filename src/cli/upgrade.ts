import { spawn } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fail, type Json } from "../core.js";

export type PackageManager = "npm" | "pnpm" | "yarn" | "bun";

export interface UpgradeInfo {
  readonly packageManager: PackageManager;
  readonly packageRoot: string;
  readonly currentVersion: string;
  readonly latestVersion?: string;
  readonly versions: readonly string[];
  readonly updateAvailable: boolean;
}

interface CommandResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number;
}

type CommandRunner = (
  command: string,
  args: readonly string[],
) => Promise<CommandResult>;

const execute: CommandRunner = async (command, args) =>
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { shell: false, windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += String(chunk)));
    child.stderr.on("data", (chunk) => (stderr += String(chunk)));
    child.on("error", reject);
    child.on("close", (code) => resolve({ stdout, stderr, code: code ?? 1 }));
  });

const packageManagers: readonly {
  readonly name: PackageManager;
  readonly root: readonly string[];
  readonly versions: readonly string[];
  readonly tags: readonly string[];
  readonly install: (version: string) => readonly string[];
}[] = [
  {
    name: "npm",
    root: ["root", "-g"],
    versions: ["view", "benchpilot", "versions", "--json"],
    tags: ["view", "benchpilot", "dist-tags", "--json"],
    install: (v) => ["install", "-g", `benchpilot@${v}`],
  },
  {
    name: "pnpm",
    root: ["root", "-g"],
    versions: ["view", "benchpilot", "versions", "--json"],
    tags: ["view", "benchpilot", "dist-tags", "--json"],
    install: (v) => ["add", "-g", `benchpilot@${v}`],
  },
  {
    name: "yarn",
    root: ["global", "dir"],
    versions: ["info", "benchpilot", "versions", "--json"],
    tags: ["info", "benchpilot", "dist-tags", "--json"],
    install: (v) => ["global", "add", `benchpilot@${v}`],
  },
  {
    name: "bun",
    root: ["pm", "cache"],
    versions: ["pm", "view", "benchpilot", "versions", "--json"],
    tags: ["pm", "view", "benchpilot", "dist-tags", "--json"],
    install: (v) => ["add", "-g", `benchpilot@${v}`],
  },
];

const childOf = (candidate: string, parent: string) => {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
};

const json = (value: string): unknown => {
  const lines = value.trim().split(/\r?\n/).reverse();
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as { data?: unknown };
      return parsed.data ?? parsed;
    } catch {}
  }
  return undefined;
};

export const compareUpgradeVersion = (left: string, right: string) => {
  const parse = (value: string) => /^v?(\d+)\.(\d+)\.(\d+)(-.+)?$/.exec(value);
  const a = parse(left);
  const b = parse(right);
  if (!a || !b) return left.localeCompare(right);
  for (let index = 1; index <= 3; index += 1) {
    const delta = Number(a[index]) - Number(b[index]);
    if (delta) return delta;
  }
  if (!a[4] && b[4]) return 1;
  if (a[4] && !b[4]) return -1;
  return (a[4] || "").localeCompare(b[4] || "");
};

const findPackageRoot = async (start: string) => {
  let current = path.resolve(start);
  while (true) {
    const candidate = path.join(current, "package.json");
    if (
      await access(candidate)
        .then(() => true)
        .catch(() => false)
    )
      return current;
    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
};

export async function checkForUpgrade(
  entrypoint: string,
  runner: CommandRunner = execute,
): Promise<UpgradeInfo> {
  const packageRoot = await findPackageRoot(path.dirname(entrypoint));
  if (!packageRoot)
    fail(
      "UPGRADE_INSTALLATION_NOT_FOUND",
      3,
      "BenchPilot installation was not found.",
    );
  const resolvedPackageRoot = packageRoot!;
  const packageJson = JSON.parse(
    await readFile(path.join(resolvedPackageRoot, "package.json"), "utf8"),
  ) as { name?: string; version?: string };
  if (packageJson.name !== "benchpilot" || !packageJson.version)
    fail(
      "UPGRADE_INSTALLATION_NOT_FOUND",
      3,
      "BenchPilot installation was not found.",
    );
  let manager: (typeof packageManagers)[number] | undefined;
  for (const candidate of packageManagers) {
    const root = await runner(candidate.name, candidate.root).catch(
      () => undefined,
    );
    if (!root || root.code !== 0) continue;
    const raw = root.stdout.trim();
    const globalRoot =
      candidate.name === "yarn" ? path.join(raw, "node_modules") : raw;
    if (globalRoot && childOf(resolvedPackageRoot, globalRoot)) {
      manager = candidate;
      break;
    }
  }
  if (!manager)
    fail(
      "UPGRADE_PACKAGE_MANAGER_NOT_FOUND",
      3,
      "The package manager used to install BenchPilot could not be identified.",
    );
  const resolvedManager = manager!;
  const [versionsResult, tagsResult] = await Promise.all([
    runner(resolvedManager.name, resolvedManager.versions),
    runner(resolvedManager.name, resolvedManager.tags),
  ]);
  if (versionsResult.code !== 0 || tagsResult.code !== 0)
    fail(
      "UPGRADE_REGISTRY_UNAVAILABLE",
      5,
      "Unable to query the package registry.",
    );
  const rawVersions = json(versionsResult.stdout);
  const versions = (Array.isArray(rawVersions) ? rawVersions : [])
    .filter((version): version is string => typeof version === "string")
    .sort((a, b) => compareUpgradeVersion(b, a));
  const tags = json(tagsResult.stdout) as { latest?: unknown } | undefined;
  const latestVersion =
    typeof tags?.latest === "string" ? tags.latest : versions[0];
  const currentVersion = packageJson.version!;
  return {
    packageManager: resolvedManager.name,
    packageRoot: resolvedPackageRoot,
    currentVersion,
    latestVersion,
    versions,
    updateAvailable: Boolean(
      latestVersion && compareUpgradeVersion(latestVersion, currentVersion) > 0,
    ),
  };
}

export async function upgradeBenchPilot(
  info: UpgradeInfo,
  version: string,
  runner: CommandRunner = execute,
) {
  if (!info.versions.includes(version))
    fail(
      "UPGRADE_VERSION_NOT_FOUND",
      2,
      `Version ${version} is not available.`,
    );
  const manager = packageManagers.find(
    (candidate) => candidate.name === info.packageManager,
  )!;
  const result = await runner(manager.name, manager.install(version));
  if (result.code !== 0)
    fail(
      "UPGRADE_FAILED",
      5,
      result.stderr || "Package manager failed to upgrade BenchPilot.",
    );
  return {
    schema: "benchpilot.upgrade",
    version: 1,
    packageManager: info.packageManager,
    previousVersion: info.currentVersion,
    installedVersion: version,
  } as Json;
}
