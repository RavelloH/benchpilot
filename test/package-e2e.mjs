import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const root = process.cwd();
const temp = await mkdtemp(path.join(os.tmpdir(), "benchpilot-package-"));
const pnpmCli = process.env.npm_execpath;

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
  execFileSync(process.execPath, [pnpmCli, "install", archive], {
    cwd: project,
    stdio: "inherit",
  });
  const env = { ...process.env, BENCHPILOT_HOME: path.join(project, "home") };
  const run = (...args) =>
    execFileSync(process.execPath, [pnpmCli, "exec", "benchpilot", ...args], {
      cwd: project,
      env,
      encoding: "utf8",
    });
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
