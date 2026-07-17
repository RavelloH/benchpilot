import test from "node:test";
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { capabilityInput } from "../dist/cli/option-parser.js";
import { parse } from "../dist/cli/parser.js";
import { ApprovalManager, PathService } from "../dist/index.js";
const exec = promisify(execFile);
const cli = path.resolve("dist/cli/index.js");
async function run(dir, ...args) {
  return exec(process.execPath, [cli, ...args], {
    cwd: dir,
    env: { ...process.env, BENCHPILOT_HOME: path.join(dir, "home") },
    encoding: "utf8",
  });
}
async function runAgent(dir, ...args) {
  return exec(process.execPath, [cli, ...args], {
    cwd: dir,
    env: {
      ...process.env,
      AI_AGENT: "fixture-agent",
      BENCHPILOT_HOME: path.join(dir, "home"),
    },
    encoding: "utf8",
  });
}
async function initDemo(dir) {
  await run(
    dir,
    "init",
    "--project-id",
    "demo",
    "--project-name",
    "Demo",
    "--locale",
    "en",
  );
  await writeFile(
    path.join(dir, "benchpilot.toml"),
    `version = 1

[project]
id = "demo"
name = "Demo"

[devices.demo]
adapter = "demo"

[systems.demo]
devices = ["demo"]

[adapters.demo]
connected = true
device_id = "demo-device-01"
operation_delay_ms = 1
`,
  );
}
test("capability boolean options are parsed without a hard-coded option list", () => {
  const parsed = parse([
    "device",
    "demo",
    "build",
    "--erase",
    "--verify=false",
    "--no-cache",
  ]);
  assert.deepEqual(parsed.flags, {});
  assert.deepEqual(parsed.rawOptions, [
    { name: "erase" },
    { name: "verify", value: "false" },
    { name: "cache", negated: true },
  ]);
  assert.deepEqual(
    capabilityInput(parsed.rawOptions, [
      { name: "erase", schema: { describe: () => ({ type: "boolean" }) } },
      { name: "verify", schema: { describe: () => ({ type: "boolean" }) } },
      { name: "cache", schema: { describe: () => ({ type: "boolean" }) } },
    ]),
    { erase: true, verify: false, cache: false },
  );
});

test("global color options use a positive internal flag", () => {
  assert.equal(parse([]).flags.color, undefined);
  assert.equal(parse(["--no-color"]).flags.color, false);
  assert.equal(parse(["--color"]).flags.color, true);
  assert.deepEqual(parse(["--no-cache"]).rawOptions, [
    { name: "cache", negated: true },
  ]);
});

test("root command prints help without starting an interactive session", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "benchpilot-root-help-"));
  try {
    const result = await run(dir);
    assert.match(result.stdout, /Agent-first device lifecycle CLI/);
    assert.equal(result.stderr, "");
    const machine = JSON.parse((await run(dir, "--json")).stdout);
    assert.deepEqual(
      { schema: machine.schema, version: machine.version },
      { schema: "benchpilot.help", version: 2 },
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("agent init without parameters is rejected without writing project files", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "benchpilot-agent-init-"));
  try {
    const human = await runAgent(dir, "init").catch((error) => error);
    assert.equal(human.code, 2);
    assert.match(human.stderr, /AGENT_INTERACTION_UNSUPPORTED/);
    await assert.rejects(access(path.join(dir, "benchpilot.toml")));
    const machine = await runAgent(dir, "init", "--json").catch(
      (error) => error,
    );
    const result = JSON.parse(machine.stdout);
    assert.equal(result.kind, "AGENT_INTERACTION_UNSUPPORTED");
    assert.equal(machine.stderr, "");
    await assert.rejects(access(path.join(dir, "benchpilot.toml")));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("agent approval confirmation is rejected before approval lookup", async () => {
  const dir = await mkdtemp(
    path.join(os.tmpdir(), "benchpilot-agent-approval-"),
  );
  try {
    const error = await runAgent(
      dir,
      "approval",
      "missing-approval",
      "approve",
      "--json",
    ).catch((failure) => failure);
    const result = JSON.parse(error.stdout);
    assert.equal(result.kind, "AGENT_INTERACTION_UNSUPPORTED");
    assert.equal(error.stderr, "");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("capability metadata maps long and short aliases back to schema fields", () => {
  const parsed = parse([
    "device",
    "demo",
    "flash",
    "--port",
    "COM7",
    "-D",
    "one",
    "-D",
    "two",
    "--",
    "target",
  ]);
  assert.deepEqual(
    capabilityInput(
      parsed.rawOptions,
      [
        { name: "port", aliases: ["--port", "-p"] },
        { name: "define", aliases: ["-D"], repeatable: true },
        { name: "target", positional: 0 },
      ],
      undefined,
      parsed.path.slice(3),
    ),
    { port: "COM7", define: ["one", "two"], target: "target" },
  );
});
test("installed CLI surface initializes and runs the demo", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "benchpilot-test-"));
  try {
    const help = await run(dir, "help");
    assert.match(help.stdout, /Agent-first device lifecycle CLI/);
    await initDemo(dir);
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
    const events = jsonl.stdout
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.ok(
      events.every(
        (event) => event.schema === "benchpilot.event" && event.version === 2,
      ),
    );
    assert.equal(events.at(-1).event.type, "operation.completed");
    assert.equal(
      events.filter((event) =>
        /operation\.(completed|failed)/.test(event.event.type),
      ).length,
      1,
    );
    assert.ok(events.some((event) => event.event.type === "stage.started"));
    const commandJsonl = await run(dir, "config", "validate", "--jsonl");
    const commandEvent = JSON.parse(commandJsonl.stdout);
    assert.equal(commandEvent.schema, "benchpilot.event");
    assert.equal(commandEvent.event.type, "command.result");
    const failedCommand = await run(dir, "config", "unknown", "--jsonl").catch(
      (error) => error,
    );
    assert.equal(JSON.parse(failedCommand.stdout).event.type, "command.failed");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("declarative demo executes build, deploy, and capture", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "benchpilot-declarative-"));
  try {
    await initDemo(dir);
    const adapters = JSON.parse(
      (await run(dir, "adapters", "list", "--json")).stdout,
    );
    assert.deepEqual(
      adapters.adapters.map((adapter) => adapter.id),
      ["demo", "esp-idf"],
    );
    const built = JSON.parse(
      (await run(dir, "device", "demo", "build", "--json")).stdout,
    );
    assert.equal(built.ok, true);
    assert.equal(built.data.kind, "build");
    assert.match(built.artifacts[0].sha256, /^[a-f0-9]{64}$/);
    const deployed = JSON.parse(
      (await run(dir, "device", "demo", "deploy", "--json")).stdout,
    );
    assert.deepEqual(Object.keys(deployed.data), ["build", "flash", "reset"]);
    const lines = (
      await run(dir, "device", "demo", "capture", "--jsonl")
    ).stdout
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.equal(lines.at(-1).event.type, "operation.completed");
    assert.equal(
      lines.filter((line) =>
        /operation\.(completed|failed)/.test(line.event.type),
      ).length,
      1,
    );
    assert.equal(lines.at(-1).data.result.data.telemetry, 42);
    const inspection = JSON.parse(
      (await run(dir, "device", "demo", "inspect", "--json")).stdout,
    );
    assert.equal(inspection.ok, true);
    assert.equal(inspection.data.kind, "info");
    const secretInspection = JSON.parse(
      (
        await run(
          dir,
          "device",
          "demo",
          "secret-inspect",
          "--token",
          "never-write-this",
          "--json",
        )
      ).stdout,
    );
    assert.equal(secretInspection.ok, true);
    assert.equal(
      JSON.stringify(secretInspection).includes("never-write-this"),
      false,
    );
    const dangerous = JSON.parse(
      (
        await run(
          dir,
          "device",
          "demo",
          "dangerous-reset",
          "--confirm-dangerous-reset",
          "--json",
        )
      ).stdout,
    );
    assert.equal(dangerous.dangerousEffectStarted, true);
    const doctor = JSON.parse(
      (await run(dir, "adapter", "demo", "doctor", "--json")).stdout,
    );
    assert.ok(
      doctor.checks.some(
        (check) => check.id === "demo-tool-node" && check.status === "pass",
      ),
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("secret approval bindings are redacted but matched by their real digest", async () => {
  const dir = await mkdtemp(
    path.join(os.tmpdir(), "benchpilot-secret-approval-"),
  );
  const token = "approval-secret-value";
  try {
    await initDemo(dir);
    const pending = await run(
      dir,
      "device",
      "demo",
      "secret-approval",
      "--token",
      token,
      "--approve-secret-approval",
      "--json",
    ).catch((error) => error);
    const requested = JSON.parse(pending.stdout);
    assert.equal(requested.kind, "HUMAN_APPROVAL_REQUIRED");
    const paths = new PathService({
      ...process.env,
      BENCHPILOT_HOME: path.join(dir, "home"),
    });
    const approvals = new ApprovalManager(paths);
    const record = await approvals.get(requested.details.approvalId);
    assert.equal(JSON.stringify(record).includes(token), false);
    assert.equal(record.binding.input.token, "[REDACTED]");
    await approvals.change(record.id, "approved");
    const approved = JSON.parse(
      (
        await run(
          dir,
          "device",
          "demo",
          "secret-approval",
          "--token",
          token,
          "--approve-secret-approval",
          "--json",
        )
      ).stdout,
    );
    assert.equal(approved.ok, true);
    const different = await run(
      dir,
      "device",
      "demo",
      "secret-approval",
      "--token",
      "different-secret-value",
      "--approve-secret-approval",
      "--json",
    ).catch((error) => error);
    assert.equal(JSON.parse(different.stdout).kind, "HUMAN_APPROVAL_REQUIRED");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("jsonl streams operation events before a delayed operation finishes", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "benchpilot-jsonl-stream-"));
  try {
    await writeFile(
      path.join(dir, "benchpilot.toml"),
      [
        "version = 1",
        "[devices.demo]",
        'adapter = "demo"',
        "[adapters.demo]",
        "operation_delay_ms = 150",
      ].join("\n"),
    );
    const child = spawn(
      process.execPath,
      [cli, "device", "demo", "deploy", "--jsonl"],
      {
        cwd: dir,
        env: { ...process.env, BENCHPILOT_HOME: path.join(dir, "home") },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let exited = false;
    child.once("exit", () => {
      exited = true;
    });
    const firstOutput = await new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("JSONL did not stream an initial event.")),
        2_000,
      );
      child.stdout.once("data", (chunk) => {
        clearTimeout(timeout);
        resolve(String(chunk));
      });
      child.once("error", reject);
    });
    assert.match(firstOutput, /operation\.started/);
    assert.equal(exited, false);
    await new Promise((resolve, reject) => {
      child.once("exit", (code) => (code === 0 ? resolve() : reject(code)));
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("jsonl emits one failed terminal event after cleanup", async () => {
  const dir = await mkdtemp(
    path.join(os.tmpdir(), "benchpilot-jsonl-failure-"),
  );
  try {
    await writeFile(
      path.join(dir, "benchpilot.toml"),
      [
        "version = 1",
        "[devices.demo]",
        'adapter = "demo"',
        "[adapters.demo]",
        'fail_stage = "flash"',
      ].join("\n"),
    );
    const failed = await run(dir, "device", "demo", "deploy", "--jsonl").catch(
      (error) => error,
    );
    const events = failed.stdout
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.ok(events.some((event) => event.event.type === "stage.failed"));
    assert.ok(events.some((event) => event.event.type === "cleanup.started"));
    assert.ok(events.some((event) => event.event.type === "cleanup.completed"));
    assert.equal(events.at(-1).event.type, "operation.failed");
    assert.equal(
      events.filter((event) =>
        /operation\.(completed|failed)/.test(event.event.type),
      ).length,
      1,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("declarative demo aborts an action when the operation times out", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "benchpilot-demo-timeout-"));
  try {
    await writeFile(
      path.join(dir, "benchpilot.toml"),
      [
        "version = 1",
        "[devices.demo]",
        'adapter = "demo"',
        "[adapters.demo]",
        "operation_delay_ms = 500",
      ].join("\n"),
    );
    const failed = await run(
      dir,
      "device",
      "demo",
      "build",
      "--timeout",
      "10ms",
      "--json",
    ).catch((error) => error);
    assert.equal(JSON.parse(failed.stdout).kind, "OPERATION_TIMEOUT");
    assert.deepEqual(
      JSON.parse((await run(dir, "locks", "list", "--json")).stdout).locks,
      [],
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("system JSONL emits child device events and one system terminal event", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "benchpilot-system-jsonl-"));
  try {
    await writeFile(
      path.join(dir, "benchpilot.toml"),
      [
        "version = 1",
        "[devices.left]",
        'adapter = "demo"',
        'device_id = "left"',
        "[devices.right]",
        'adapter = "demo"',
        'device_id = "right"',
        "[systems.test]",
        'devices = ["left", "right"]',
      ].join("\n"),
    );
    const output = await run(dir, "system", "test", "deploy", "--jsonl");
    const events = output.stdout
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.equal(
      events.filter(
        (event) => event.event.type === "system.operation.completed",
      ).length,
      1,
    );
    assert.equal(
      events.filter((event) => event.event.type === "command.result").length,
      0,
    );
    assert.ok(
      events.some(
        (event) =>
          event.event.type === "device.operation.completed" &&
          event.context.system === "test" &&
          event.context.device === "left",
      ),
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a failed system status waits for every child before its terminal event", async () => {
  const dir = await mkdtemp(
    path.join(os.tmpdir(), "benchpilot-system-failure-"),
  );
  try {
    await writeFile(
      path.join(dir, "benchpilot.toml"),
      [
        "version = 1",
        "[devices.fast]",
        'adapter = "test"',
        "[devices.slow]",
        'adapter = "test"',
        "[systems.test]",
        'devices = ["fast", "slow"]',
      ].join("\n"),
    );
    const module = path.resolve("dist/cli/index.js").replaceAll("\\", "/");
    const script = `import { main } from ${JSON.stringify(`file:///${module}`)}; const adapter = { id: "test", apiVersion: 1, version: "1", summary: "test adapter", configSchema: { parse: (value) => value, describe: () => ({ type: "object" }) }, discover: async () => [], doctor: async () => [], createDevice: async (instance) => ({ identity: { instance, physicalId: instance, adapter: "test" }, capabilities: () => [{ id: "status", summary: "status", defaultTimeoutMs: 1000, lockMode: "none", createsRun: false, safety: { mode: "normal" }, execute: async () => { if (instance === "fast") throw new Error("fast failed"); await new Promise((resolve) => setTimeout(resolve, 40)); return { state: "ready" }; } }] }) }; process.argv = [process.execPath, "benchpilot", "system", "test", "status", "--jsonl"]; await main([adapter]);`;
    const output = await exec(
      process.execPath,
      ["--input-type=module", "-e", script],
      {
        cwd: dir,
        env: {
          ...process.env,
          BENCHPILOT_HOME: path.join(dir, "home"),
          BENCHPILOT_NO_AUTORUN: "1",
        },
        encoding: "utf8",
      },
    ).catch((error) => error);
    const events = output.stdout
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.equal(events.at(-1).event.type, "system.operation.failed");
    assert.equal(
      events.filter((event) => event.event.type === "system.operation.failed")
        .length,
      1,
    );
    const slowCompleted = events.findIndex(
      (event) =>
        event.event.type === "device.operation.completed" &&
        event.context.device === "slow",
    );
    assert.ok(slowCompleted >= 0);
    assert.ok(slowCompleted < events.length - 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("injected adapter executes through the dynamic CLI route", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "benchpilot-injected-"));
  try {
    await (
      await import("node:fs/promises")
    ).writeFile(
      path.join(dir, "benchpilot.toml"),
      'version = 1\n[devices.test-device]\nadapter = "test"\n',
    );
    const module = path.resolve("dist/cli/index.js").replaceAll("\\", "/");
    const script = `import { main } from ${JSON.stringify(`file:///${module}`)}; const adapter = { id: "test", apiVersion: 1, version: "1", summary: "test adapter", configSchema: { parse: (value) => value, describe: () => ({ type: "object" }) }, discover: async () => [{ adapter: "test", id: "candidate" }], doctor: async () => [], createDevice: async (instance) => ({ identity: { instance, physicalId: "test-physical", adapter: "test" }, capabilities: () => [{ id: "echo", summary: "echo", defaultTimeoutMs: 1000, lockMode: "none", createsRun: false, safety: { mode: "normal" }, execute: async (_ctx, input) => ({ echoed: input.duration ?? "ok" }) }] }) }; process.argv = [process.execPath, "benchpilot", "device", "test-device", "echo", "--json"]; await main([adapter]);`;
    const result = await exec(
      process.execPath,
      ["--input-type=module", "-e", script],
      {
        cwd: dir,
        env: {
          ...process.env,
          BENCHPILOT_HOME: path.join(dir, "home"),
          BENCHPILOT_NO_AUTORUN: "1",
        },
        encoding: "utf8",
      },
    );
    assert.equal(JSON.parse(result.stdout).data.echoed, "ok");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("dry-run creates no run, lock, approval, or artifact state", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "benchpilot-dry-run-"));
  try {
    await initDemo(dir);
    const plan = JSON.parse(
      (await run(dir, "device", "demo", "build", "--dry-run", "--json")).stdout,
    );
    assert.equal(plan.dryRun, true);
    assert.deepEqual(
      JSON.parse((await run(dir, "runs", "list", "--json")).stdout).runs,
      [],
    );
    assert.deepEqual(
      JSON.parse((await run(dir, "locks", "list", "--json")).stdout).locks,
      [],
    );
    assert.deepEqual(
      JSON.parse((await run(dir, "approvals", "list", "--json")).stdout)
        .approvals,
      [],
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
