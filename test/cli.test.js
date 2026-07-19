import test from "node:test";
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { capabilityInput } from "../dist/cli/option-parser.js";
import { parse } from "../dist/cli/parser.js";
import { ApprovalManager, PathService } from "../dist/index.js";
const exec = promisify(execFile);
const cli = path.resolve("dist/cli/index.js");
function cliEnv(dir) {
  const env = {
    ...process.env,
    HOME: dir,
    USERPROFILE: dir,
    TEMP: path.join(dir, "runtime"),
    BENCHPILOT_TEST_ADAPTER_BUNDLES: path.resolve("test", ".adapter-bundles"),
  };
  for (const key of [
    "CODEX_THREAD_ID",
    "CODEX_CI",
    "CODEX_SANDBOX",
    "CODEX_SANDBOX_NETWORK_DISABLED",
  ])
    delete env[key];
  return env;
}
async function run(dir, ...args) {
  return exec(process.execPath, [cli, ...args], {
    cwd: dir,
    env: cliEnv(dir),
    encoding: "utf8",
  });
}
async function runAgent(dir, ...args) {
  return exec(process.execPath, [cli, ...args], {
    cwd: dir,
    env: {
      ...cliEnv(dir),
      AI_AGENT: "fixture-agent",
    },
    encoding: "utf8",
  });
}
async function initDemo(dir) {
  await run(dir, "init", "--project-name", "Demo", "--locale", "en");
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

[adapters]
enabled = ["demo"]

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
    assert.doesNotMatch(result.stdout, /████/);
    assert.equal(result.stderr, "");
    const machine = JSON.parse((await run(dir, "--json")).stdout);
    assert.ok(Array.isArray(machine));
    assert.equal(machine[0].name, "introduction");
    assert.equal(machine[1].name, "command");
    assert.equal("visibility" in machine[0], false);
    assert.match(machine[0].text, /Agent-first device lifecycle CLI/);
    assert.doesNotMatch(JSON.stringify(machine), /lineBreak|\\n/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("language persists the global CLI locale", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "benchpilot-language-"));
  try {
    const listed = await run(dir, "language", "list");
    assert.match(listed.stdout, /en\s+English/);
    assert.match(listed.stdout, /zh-CN\s+简体中文/);
    const updated = await run(dir, "language", "set", "zh-CN");
    assert.equal(updated.stdout, "zh-CN\n");
    assert.match(
      await readFile(path.join(dir, ".benchpilot", "config.toml"), "utf8"),
      /locale = "zh-CN"/,
    );
    assert.equal((await run(dir, "language", "get")).stdout, "zh-CN\n");
    assert.match((await run(dir)).stdout, /面向 Agent 的设备生命周期 CLI/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("init bootstraps the global language and ignores legacy project locales", async () => {
  const dir = await mkdtemp(
    path.join(os.tmpdir(), "benchpilot-init-language-"),
  );
  try {
    const initialized = await run(
      dir,
      "init",
      "--project-name",
      "Demo",
      "--locale",
      "zh-CN",
    );
    assert.match(initialized.stdout, /BenchPilot 项目已初始化。/);
    assert.match(initialized.stdout, /项目 ID\s+project-[0-9a-f-]{36}/);
    assert.match(initialized.stdout, /已启用适配器\s+无/);
    assert.match(
      await readFile(path.join(dir, ".benchpilot", "config.toml"), "utf8"),
      /locale = "zh-CN"/,
    );
    const local = path.join(dir, ".benchpilot", "config.local.toml");
    assert.doesNotMatch(await readFile(local, "utf8"), /locale/);

    await writeFile(local, '[cli]\nlocale = "en"\n');
    assert.match((await run(dir)).stdout, /面向 Agent 的设备生命周期 CLI/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("init applies an existing project configuration without prompting", async () => {
  const dir = await mkdtemp(
    path.join(os.tmpdir(), "benchpilot-init-existing-cli-"),
  );
  try {
    await writeFile(
      path.join(dir, "benchpilot.toml"),
      'version = 1\n[project]\nid = "existing-project"\nname = "Existing project"\n[adapters]\nenabled = []\n',
    );
    const result = await run(dir, "init");
    assert.match(
      result.stdout,
      /Applied existing BenchPilot project configuration/,
    );
    assert.match(result.stdout, /Existing project/);
    await access(path.join(dir, ".benchpilot", "config.local.toml"));
    const machine = JSON.parse((await run(dir, "init", "--json")).stdout);
    assert.equal(machine.existing, true);
    assert.equal(machine.config.project.id, "existing-project");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("doctor reports project-local configuration and enabled adapter readiness", async () => {
  const dir = await mkdtemp(
    path.join(os.tmpdir(), "benchpilot-doctor-readiness-"),
  );
  try {
    await run(dir, "init", "--project-name", "Doctor", "--locale", "en");
    const doctor = JSON.parse((await run(dir, "doctor", "--json")).stdout);
    const checks = new Map(doctor.checks.map((check) => [check.id, check]));
    assert.equal(checks.get("project-local").status, "pass");
    assert.equal(checks.get("adapters").status, "warn");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("language without an action requires an interactive human session", async () => {
  const dir = await mkdtemp(
    path.join(os.tmpdir(), "benchpilot-language-agent-"),
  );
  try {
    const error = await run(dir, "language", "--agent").catch(
      (failure) => failure,
    );
    assert.equal(error.code, 2);
    assert.match(error.stderr, /AGENT_INTERACTION_UNSUPPORTED/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("color flags only affect human root output", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "benchpilot-color-"));
  try {
    assert.match((await run(dir, "--color")).stdout, /\u001B\[/);
    assert.doesNotMatch(
      (await run(dir, "--color", "--no-color")).stdout,
      /\u001B\[/,
    );
    assert.doesNotMatch(
      (await run(dir, "--color", "--json")).stdout,
      /\u001B\[/,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("home falls back to non-interactive Agent command syntax outside human TTY mode", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "benchpilot-home-"));
  try {
    const human = await run(dir, "home", "--agent");
    assert.match(human.stdout, /Agent-first device lifecycle CLI/);
    assert.doesNotMatch(human.stdout, /Open the guided interactive interface/);
    assert.match(
      human.stdout,
      /benchpilot device <list\|scan\|device-instance>/,
    );
    const machine = JSON.parse((await runAgent(dir, "home", "--json")).stdout);
    assert.ok(Array.isArray(machine));
    assert.equal(machine[0].name, "introduction");
    assert.doesNotMatch(JSON.stringify(machine), /___/);
    assert.doesNotMatch(JSON.stringify(machine), /"home"/);
    assert.match(
      JSON.stringify(machine),
      /benchpilot device <list\|scan\|device-instance>/,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("version command renders the large wordmark and supports machine output", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "benchpilot-version-"));
  try {
    const human = await run(dir, "version");
    assert.doesNotMatch(human.stdout, /████/);
    assert.match(human.stdout, /BenchPilot v0\.0\.0/);
    const machine = JSON.parse((await run(dir, "version", "--json")).stdout);
    assert.deepEqual(
      machine.map((node) => node.name),
      ["version"],
    );
    assert.match(machine[0].children[0].text, /BenchPilot v0\.0\.0/);
    assert.match(machine[0].children[1].text, new RegExp(process.version));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("root presentation JSONL frames a cleaned, ordered page snapshot", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "benchpilot-presentation-"));
  try {
    const raw = (await run(dir, "--color", "--jsonl")).stdout;
    const events = raw
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.deepEqual(events[0], {
      op: "start",
      protocol: "benchpilot.presentation",
      version: 1,
      locale: "en",
      view: "normal",
    });
    assert.equal(events.at(-1).op, "complete");
    assert.equal(events.at(-1).count, events.length - 2);
    assert.deepEqual(
      events.slice(1, -1).map((event) => event.index),
      Array.from({ length: events.length - 2 }, (_, index) => index),
    );
    assert.deepEqual(Object.keys(events[1]).slice(0, 3), [
      "op",
      "index",
      "key",
    ]);
    assert.doesNotMatch(raw, /lineBreak/);
    const device = events.find(
      (event) => event.key === "command.resources-and-orchestration.device",
    );
    assert.match(device.text, /^device /);
    assert.doesNotMatch(device.text, /\u001B\[/);
    assert.doesNotMatch(device.text, / {2,}|\t/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("root and version help pages take precedence over agent presentation", async () => {
  const dir = await mkdtemp(
    path.join(os.tmpdir(), "benchpilot-presentation-help-"),
  );
  try {
    const root = (await runAgent(dir, "--help", "--jsonl")).stdout
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.equal(root[0].view, "help");
    assert.equal(root[1].key, "name");
    const detailed = JSON.parse(
      (await runAgent(dir, "--help", "--json")).stdout,
    );
    const commands = detailed.find((node) => node.name === "commands");
    assert.ok(commands);
    assert.match(
      JSON.stringify(commands),
      /benchpilot run <run-id> logs \[options\]/,
    );
    const version = JSON.parse(
      (await runAgent(dir, "version", "--help", "--json")).stdout,
    );
    assert.equal(version[0].name, "name");
    assert.ok(
      version[0].children.some((node) => /benchpilot version/.test(node.text)),
    );
    const global = JSON.parse((await run(dir, "--version", "--json")).stdout);
    assert.match(global[0].children[0].text, /BenchPilot v0\.0\.0/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("static command help endpoints share the presentation protocol", async () => {
  const dir = await mkdtemp(
    path.join(os.tmpdir(), "benchpilot-command-presentation-help-"),
  );
  try {
    const fromHelp = JSON.parse(
      (await run(dir, "help", "config", "--json")).stdout,
    );
    const fromFlag = JSON.parse(
      (await run(dir, "config", "--help", "--json")).stdout,
    );
    assert.deepEqual(fromHelp, fromFlag);
    assert.deepEqual(
      fromHelp.slice(0, 2).map((node) => node.name),
      ["name", "synopsis"],
    );
    assert.match(JSON.stringify(fromHelp), /benchpilot config get <key>/);
    assert.doesNotMatch(JSON.stringify(fromHelp), /visibility|lineBreak/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("nested device help never starts an interactive session", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "benchpilot-device-help-"));
  try {
    await initDemo(dir);
    const result = await run(dir, "device", "demo", "--help");
    assert.match(result.stdout, /benchpilot device demo/);
    assert.equal(result.stderr, "");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("lock list reports corrupt lock records without failing the whole listing", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "benchpilot-lock-list-"));
  try {
    const corrupt = path.join(
      dir,
      "runtime",
      "benchpilot",
      "locks",
      "invalid-owner",
    );
    await mkdir(corrupt, { recursive: true });
    await writeFile(path.join(corrupt, "owner.json"), "not-json");
    const result = JSON.parse(
      (await run(dir, "lock", "list", "--json")).stdout,
    );
    assert.equal(result.schema, "benchpilot.lock-list");
    assert.deepEqual(result.locks, []);
    assert.deepEqual(
      result.corrupt.map((entry) => entry.id),
      ["invalid-owner"],
    );
    const inspection = await run(
      dir,
      "lock",
      "invalid-owner",
      "show",
      "--json",
    ).catch((error) => error);
    assert.equal(JSON.parse(inspection.stdout).kind, "LOCK_CORRUPT");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("lock show renders grouped details on screen", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "benchpilot-lock-show-"));
  try {
    const lockId = "visible-lock";
    const lock = path.join(dir, "runtime", "benchpilot", "locks", lockId);
    await mkdir(lock, { recursive: true });
    await writeFile(
      path.join(lock, "owner.json"),
      JSON.stringify({
        schema: "benchpilot.lock",
        version: 2,
        state: "active",
        lockId,
        identity: {
          adapter: "fixture-adapter",
          kind: "device",
          physicalId: "fixture-device",
        },
        ownerToken: "fixture-owner",
        pid: 1234,
        hostname: "fixture-host",
        command: "fixture-command",
        acquiredAt: "2026-01-01T00:00:00.000Z",
        heartbeatAt: "2026-01-01T00:00:05.000Z",
        expiresAt: "2026-01-01T00:00:35.000Z",
      }),
    );
    const list = await run(dir, "lock", "list");
    assert.match(
      list.stdout,
      /^Physical resource locks\n  Lock ID\s+Current status\s+Resource\n  visible-lock\s+Stale\s+fixture-adapter \/ device/m,
    );
    const listMachine = JSON.parse(
      (await run(dir, "lock", "list", "--json")).stdout,
    );
    assert.equal(listMachine.locks[0].liveness, "stale");
    assert.equal(listMachine.locks[0].state, "active");
    const listFrames = (await run(dir, "lock", "list", "--jsonl")).stdout
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.deepEqual(listFrames[1], {
      op: "snapshot",
      index: 0,
      key: `locks.${lockId}`,
      value: listMachine.locks[0],
    });
    assert.deepEqual(listFrames.at(-1), { op: "complete", count: 1 });
    const result = await run(dir, "lock", lockId, "show");
    assert.match(
      result.stdout,
      /^Lock details\n  Lock ID\s+visible-lock\n  Current status\s+Stale\n  Record state\s+Active/m,
    );
    assert.match(result.stdout, /\nResource\n  Adapter\s+fixture-adapter/m);
    assert.match(result.stdout, /\nOwner\n  Host\s+fixture-host/m);
    assert.match(
      result.stdout,
      /\nTiming\n  Acquired\s+2026-01-01T00:00:00.000Z/m,
    );
    assert.doesNotMatch(result.stdout, /"ownerToken"/);
    const machine = JSON.parse(
      (await run(dir, "lock", lockId, "show", "--json")).stdout,
    );
    assert.deepEqual(machine, {
      schema: "benchpilot.lock-detail",
      version: 1,
      id: lockId,
      liveness: "stale",
      state: "active",
      resource: {
        adapter: "fixture-adapter",
        kind: "device",
        physicalId: "fixture-device",
      },
      owner: {
        hostname: "fixture-host",
        pid: 1234,
        command: "fixture-command",
      },
      timing: {
        acquiredAt: "2026-01-01T00:00:00.000Z",
        heartbeatAt: "2026-01-01T00:00:05.000Z",
        expiresAt: "2026-01-01T00:00:35.000Z",
      },
    });
    assert.doesNotMatch(JSON.stringify(machine), /ownerToken|\u001B\[/);
    const frames = (await run(dir, "lock", lockId, "show", "--jsonl")).stdout
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.equal(frames[0].protocol, "benchpilot.data");
    assert.equal(frames[0].schema, "benchpilot.lock-detail");
    assert.deepEqual(frames[1], {
      op: "snapshot",
      index: 0,
      key: "result",
      value: machine,
    });
    const cleared = JSON.parse(
      (await run(dir, "lock", lockId, "clear", "--json")).stdout,
    );
    assert.deepEqual(cleared, {
      schema: "benchpilot.lock-clear",
      version: 1,
      lock: {
        id: lockId,
        state: "active",
        resource: {
          adapter: "fixture-adapter",
          kind: "device",
          physicalId: "fixture-device",
        },
        owner: {
          hostname: "fixture-host",
          pid: 1234,
          command: "fixture-command",
        },
        timing: {
          acquiredAt: "2026-01-01T00:00:00.000Z",
          heartbeatAt: "2026-01-01T00:00:05.000Z",
          expiresAt: "2026-01-01T00:00:35.000Z",
        },
      },
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("lock clear-stale summarizes at most five cleared locks on screen", async () => {
  const dir = await mkdtemp(
    path.join(os.tmpdir(), "benchpilot-lock-clear-stale-"),
  );
  try {
    const root = path.join(dir, "runtime", "benchpilot", "locks");
    const expired = "1970-01-01T00:00:00.000Z";
    const ids = Array.from({ length: 6 }, (_, index) => `stale-${index + 1}`);
    for (const lockId of ids) {
      const lock = path.join(root, lockId);
      await mkdir(lock, { recursive: true });
      await writeFile(
        path.join(lock, "owner.json"),
        JSON.stringify({
          schema: "benchpilot.lock",
          version: 2,
          state: "active",
          lockId,
          identity: {
            adapter: "fixture",
            kind: "device",
            physicalId: lockId,
          },
          ownerToken: "fixture-owner",
          pid: 999999,
          hostname: "fixture-host",
          command: "fixture",
          acquiredAt: expired,
          heartbeatAt: expired,
          expiresAt: expired,
        }),
      );
    }
    const result = await run(dir, "lock", "clear-stale");
    assert.match(result.stdout, /^Cleared stale locks:/);
    for (const id of ids.slice(1).reverse())
      assert.match(result.stdout, new RegExp(`^  ${id}$`, "m"));
    assert.doesNotMatch(result.stdout, /^  stale-1$/m);
    assert.match(result.stdout, /… and 6 stale locks in total\./);
    assert.doesNotMatch(result.stdout, /"cleared"/);
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
    assert.equal(result.diagnosticId, "core.agent-interaction-unsupported");
    assert.equal(machine.stderr, "");
    const stream = await runAgent(dir, "init", "--jsonl").catch(
      (error) => error,
    );
    const events = stream.stdout
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.equal(events.length, 1);
    assert.equal(events[0].event.type, "command.failed");
    assert.equal(events[0].data.error.kind, "AGENT_INTERACTION_UNSUPPORTED");
    assert.equal(stream.stderr, "");
    await assert.rejects(access(path.join(dir, "benchpilot.toml")));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("agent mode rejects interactive commands like an agent", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "benchpilot-agent-mode-"));
  try {
    const error = await run(dir, "init", "--agent", "--json").catch(
      (failure) => failure,
    );
    const result = JSON.parse(error.stdout);
    assert.equal(result.kind, "AGENT_INTERACTION_UNSUPPORTED");
    assert.equal(error.stderr, "");
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

test("agent cannot use an incomplete nested command as an interactive probe", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "benchpilot-agent-device-"));
  try {
    await initDemo(dir);
    const error = await runAgent(dir, "device", "demo", "--json").catch(
      (failure) => failure,
    );
    const result = JSON.parse(error.stdout);
    assert.equal(result.kind, "AGENT_INTERACTION_UNSUPPORTED");
    assert.equal(error.stderr, "");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("init switches human error presentation to the selected locale", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "benchpilot-init-locale-"));
  try {
    const error = await run(
      dir,
      "init",
      "--project-name",
      " ",
      "--locale",
      "zh-CN",
    ).catch((failure) => failure);
    assert.match(error.stderr, /用法错误/);
    await assert.rejects(access(path.join(dir, "benchpilot.toml")));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("init rejects a user-supplied project ID", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "benchpilot-init-id-"));
  try {
    const error = await run(
      dir,
      "init",
      "--project-id",
      "manual-id",
      "--project-name",
      "Demo",
      "--locale",
      "en",
    ).catch((failure) => failure);
    assert.equal(error.code, 2);
    assert.match(error.stderr, /Usage error/);
    await assert.rejects(access(path.join(dir, "benchpilot.toml")));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("human command help uses the global locale", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "benchpilot-help-locale-"));
  try {
    await run(dir, "init", "--project-name", "演示", "--locale", "zh-CN");
    assert.match((await run(dir)).stdout, /面向 Agent 的设备生命周期 CLI/);
    assert.match((await run(dir, "help", "config")).stdout, /名称/);
    assert.match(
      (await run(dir, "config", "--help")).stdout,
      /读取、解释、校验/,
    );
    const machine = JSON.parse((await run(dir, "--help", "--json")).stdout);
    assert.equal(machine[0].name, "name");
    assert.match(machine[0].text, /名称/);
    assert.match(machine[0].children[0].text, /面向 Agent 的设备生命周期 CLI/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("dynamic device help localizes its presentation labels", async () => {
  const dir = await mkdtemp(
    path.join(os.tmpdir(), "benchpilot-device-help-zh-"),
  );
  try {
    await initDemo(dir);
    await run(dir, "language", "set", "zh-CN");
    const result = await run(dir, "device", "demo", "--help");
    assert.match(result.stdout, /命令:/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("unknown administrative subcommands are usage errors", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "benchpilot-admin-usage-"));
  try {
    for (const args of [
      ["run", "list", "unknown"],
      ["lock", "list", "unknown"],
      ["approval", "list", "unknown"],
    ]) {
      const error = await run(dir, ...args, "--json").catch(
        (failure) => failure,
      );
      assert.equal(JSON.parse(error.stdout).kind, "USAGE_ERROR");
    }
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
      (await run(dir, "adapter", "list", "--json")).stdout,
    );
    assert.deepEqual(
      adapters.data.adapters.map((adapter) => adapter.id),
      ["demo"],
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
    assert.deepEqual(
      JSON.parse((await run(dir, "approval", "list", "--json")).stdout)
        .approvals,
      [],
    );
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
    const runList = JSON.parse(
      (await run(dir, "run", "list", "--json")).stdout,
    );
    assert.equal(runList.schema, "benchpilot.run-list");
    assert.equal(runList.runs[0].status, "succeeded");
    assert.equal(runList.runs[0].command, "device.capture");
    const runId = runList.runs[0].id;
    const runDetail = JSON.parse(
      (await run(dir, "run", runId, "show", "--json")).stdout,
    );
    assert.equal(runDetail.schema, "benchpilot.run-detail");
    assert.equal(runDetail.run.id, runId);
    const runFrames = (await run(dir, "run", "list", "--jsonl")).stdout
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.equal(runFrames[0].schema, "benchpilot.run-list");
    assert.match(runFrames[1].key, /^runs\./);
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
    const pendingDangerous = await run(
      dir,
      "device",
      "demo",
      "dangerous-reset",
      "--confirm-dangerous-reset",
      "--json",
    ).catch((error) => error);
    assert.equal(
      JSON.parse(pendingDangerous.stdout).kind,
      "HUMAN_APPROVAL_REQUIRED",
    );
    await run(dir, "config", "set", "approval.level", "bypass");
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
      doctor.data.checks.some(
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
    await run(dir, "config", "set", "approval.level", "strict");
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
      TEMP: path.join(dir, "runtime"),
    });
    const approvals = new ApprovalManager(paths, dir);
    const record = await approvals.get(requested.details.approvalId);
    assert.equal(JSON.stringify(record).includes(token), false);
    assert.equal(record.binding.input.token, "[REDACTED]");
    assert.equal(
      record.binding.presentation.command.capability,
      "secret-approval",
    );
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
        "[adapters]",
        'enabled = ["demo"]',
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
        env: { ...process.env, TEMP: path.join(dir, "runtime") },
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
        "[adapters]",
        'enabled = ["demo"]',
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
        "[adapters]",
        'enabled = ["demo"]',
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
    assert.equal(
      JSON.parse(failed.stdout).diagnosticId,
      "core.operation-timeout",
    );
    assert.deepEqual(
      JSON.parse((await run(dir, "lock", "list", "--json")).stdout).locks,
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
        "[adapters]",
        'enabled = ["demo"]',
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
        "[adapters]",
        'enabled = ["test"]',
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
          TEMP: path.join(dir, "runtime"),
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
      'version = 1\n[adapters]\nenabled = ["test"]\n[devices.test-device]\nadapter = "test"\n',
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
          TEMP: path.join(dir, "runtime"),
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
    const dryRunEvents = (
      await run(dir, "device", "demo", "build", "--dry-run", "--jsonl")
    ).stdout
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.deepEqual(
      dryRunEvents.map((event) => event.event.type),
      ["command.result"],
    );
    assert.deepEqual(dryRunEvents[0].data.result, plan);
    assert.deepEqual(
      JSON.parse((await run(dir, "run", "list", "--json")).stdout).runs,
      [],
    );
    assert.deepEqual(
      JSON.parse((await run(dir, "lock", "list", "--json")).stdout).locks,
      [],
    );
    assert.deepEqual(
      JSON.parse((await run(dir, "approval", "list", "--json")).stdout)
        .approvals,
      [],
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("approval commands render structured screen, JSON, and itemized JSONL data", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "benchpilot-approval-cli-"));
  try {
    await initDemo(dir);
    const paths = new PathService({
      ...process.env,
      TEMP: path.join(dir, "runtime"),
    });
    const approvals = new ApprovalManager(paths, dir);
    const binding = {
      command: "device.demo.deploy",
      device: {
        adapter: "demo",
        instance: "demo",
        physicalId: "demo-device-01",
      },
      input: { profile: "release" },
      project: "demo",
    };
    const approval = await approvals.request(binding, 3_600_000, {
      ...binding,
      presentation: {
        command: { capability: "deploy", summary: "Deploy" },
        project: { name: "Demo" },
      },
    });
    const list = JSON.parse(
      (await run(dir, "approval", "list", "--json")).stdout,
    );
    assert.equal(list.schema, "benchpilot.approval-list");
    assert.equal(list.approvals[0].id, approval.id);
    assert.equal(list.approvals[0].binding.device.physicalId, "demo-device-01");
    const events = (await run(dir, "approval", "list", "--jsonl")).stdout
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.deepEqual(
      events.map((event) => event.op),
      ["start", "snapshot", "complete"],
    );
    assert.equal(events[1].key, `approvals.${approval.id}`);
    const detail = await run(dir, "approval", approval.id, "inspect");
    assert.match(detail.stdout, /Approval details/);
    assert.match(detail.stdout, /Deploy/);
    assert.match(detail.stdout, /Demo/);
    assert.match(detail.stdout, /demo-device-01/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
