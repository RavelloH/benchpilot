import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  access,
  mkdir,
  mkdtemp,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const root = process.cwd();
const temp = await mkdtemp(path.join(os.tmpdir(), "benchpilot-package-"));
const pnpmCli = process.env.npm_execpath;
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const npmCommand = (args, options) => {
  if (process.platform !== "win32") return execFileSync(npm, args, options);
  return execFileSync(
    process.env.ComSpec || "cmd.exe",
    ["/d", "/c", "npm", ...args],
    options,
  );
};

try {
  assert.ok(pnpmCli, "pnpm CLI path is unavailable.");
  execFileSync(
    process.execPath,
    [pnpmCli, "pack", "--pack-destination", temp],
    {
      cwd: root,
      stdio: "inherit",
    },
  );
  const archive = path.join(
    temp,
    (await readdir(temp)).find((name) => name.endsWith(".tgz")) || "",
  );
  assert.notEqual(archive, temp, "pnpm pack did not create an archive.");
  const project = path.join(temp, "project");
  await mkdir(project);
  await writeFile(
    path.join(project, "package.json"),
    `${JSON.stringify({ private: true }, null, 2)}\n`,
  );
  npmCommand(["install", archive], {
    cwd: project,
    stdio: "inherit",
  });
  const env = { ...process.env, BENCHPILOT_HOME: path.join(project, "home") };
  const run = (...args) =>
    npmCommand(["exec", "--no", "--", "benchpilot", ...args], {
      cwd: project,
      env,
      encoding: "utf8",
    });
  assert.match(run("--version"), /0\.0\.0/);
  assert.match(run("help"), /Agent-first device lifecycle CLI/);
  await access(
    path.join(
      project,
      "node_modules",
      "benchpilot",
      "dist",
      "i18n",
      "zh-CN.js",
    ),
  );
  await access(
    path.join(
      project,
      "node_modules",
      "benchpilot",
      "dist",
      "adapters",
      "bundles",
      "index.json",
    ),
  );
  run(
    "init",
    "--project-id",
    "demo",
    "--project-name",
    "Demo",
    "--locale",
    "en",
  );
  await writeFile(
    path.join(project, "benchpilot.toml"),
    `version = 1

[project]
id = "demo"
name = "Demo"

[devices.demo]
adapter = "demo"

[adapters.demo]
connected = true
device_id = "demo-device-01"
operation_delay_ms = 1
`,
  );
  const commands = [
    ["doctor", "--json"],
    ["adapters", "list", "--json"],
    ["devices", "scan", "--json"],
    ["device", "demo", "build", "--json"],
    ["device", "demo", "deploy", "--json"],
    ["device", "demo", "capture", "--json"],
    ["runs", "list", "--json"],
  ];
  for (const args of commands)
    assert.doesNotThrow(() => JSON.parse(run(...args)));
  const events = run("device", "demo", "deploy", "--jsonl")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.equal(events.at(-1).event.type, "operation.completed");
  assert.equal(
    events.filter((event) =>
      /operation\.(completed|failed)/.test(event.event.type),
    ).length,
    1,
  );
} finally {
  await rm(temp, { recursive: true, force: true });
}
