import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
const exec = promisify(execFile);
const cli = path.resolve("dist/cli/index.js");
async function run(dir, ...args) {
  return exec(process.execPath, [cli, ...args], {
    cwd: dir,
    env: { ...process.env, BENCHPILOT_HOME: path.join(dir, "home") },
    encoding: "utf8",
  });
}
test("installed CLI surface initializes and runs the demo", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "benchpilot-test-"));
  try {
    const help = await run(dir);
    assert.match(help.stdout, /Agent-first device lifecycle CLI/);
    await run(dir, "init");
    const deployed = await run(dir, "device", "demo", "deploy", "--json");
    const result = JSON.parse(deployed.stdout);
    assert.equal(result.ok, true);
    assert.ok(result.runId);
    const built = await run(dir, "device", "demo", "build", "--json");
    assert.match(
      JSON.parse(built.stdout).artifacts[0].sha256,
      /^[a-f0-9]{64}$/,
    );
    const jsonl = await run(dir, "device", "demo", "deploy", "--jsonl");
    for (const line of jsonl.stdout.trim().split("\n"))
      assert.doesNotThrow(() => JSON.parse(line));
    const safe = await run(
      dir,
      "device",
      "demo",
      "factory-reset",
      "--json",
    ).catch((e) => e);
    assert.equal(
      JSON.parse(safe.stdout).kind,
      "DANGEROUS_CONFIRMATION_REQUIRED",
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
