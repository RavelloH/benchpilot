import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const root = process.cwd();
const temp = await mkdtemp(path.join(os.tmpdir(), "benchpilot-package-"));
const pnpmCli = process.env.npm_execpath;
const npmCli = path.join(
  path.dirname(process.execPath),
  "node_modules",
  "npm",
  "bin",
  "npm-cli.js",
);
const npxCli = path.join(
  path.dirname(process.execPath),
  "node_modules",
  "npm",
  "bin",
  "npx-cli.js",
);

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
  execFileSync(process.execPath, [npmCli, "init", "-y"], {
    cwd: temp,
    stdio: "ignore",
  });
  execFileSync(process.execPath, [npmCli, "install", archive], {
    cwd: temp,
    stdio: "inherit",
  });
  const project = path.join(temp, "project");
  await mkdir(project);
  const env = { ...process.env, BENCHPILOT_HOME: path.join(project, "home") };
  const run = (...args) =>
    execFileSync(
      process.execPath,
      [npxCli, "--no-install", "benchpilot", ...args],
      {
        cwd: project,
        env,
        encoding: "utf8",
      },
    );
  assert.match(run("--version"), /0\.0\.0/);
  assert.match(run(), /Agent-first device lifecycle CLI/);
  run("init");
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
