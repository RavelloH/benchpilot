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
import { packageVersion } from "../dist/version.js";
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

const machineError = (result) => {
  let current = result;
  while (current && typeof current === "object") {
    if (current.error && typeof current.error === "object") {
      current = current.error;
      continue;
    }
    if (typeof current.kind === "string") return current;
    current = current.data;
  }
  return result;
};
async function initDemo(dir, { discover = true } = {}) {
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
members = [{ device = "demo" }]

[adapters]
enabled = ["demo"]

[adapters.demo]
connected = true
device_id = "demo-device-01"
operation_delay_ms = 1
`,
  );
  if (discover) await run(dir, "adapter", "demo", "discover", "--json");
}

test("system commands manage member definitions and render details", async () => {
  const dir = await mkdtemp(
    path.join(os.tmpdir(), "benchpilot-system-manage-"),
  );
  try {
    await initDemo(dir);
    await writeFile(
      path.join(dir, "benchpilot.toml"),
      (await readFile(path.join(dir, "benchpilot.toml"), "utf8")) +
        '\n[devices.second]\nadapter = "demo"\n',
    );
    const created = JSON.parse(
      (await run(dir, "system", "create", "pair", "demo", "second", "--json"))
        .stdout,
    );
    assert.equal(created.data.key, "systems.pair");
    const detail = JSON.parse(
      (await run(dir, "system", "pair", "show", "--json")).stdout,
    );
    assert.deepEqual(
      detail.data.system.members.map((member) => member.device),
      ["demo", "second"],
    );
    await run(dir, "system", "member", "remove", "pair", "second", "--json");
    const listed = JSON.parse(
      (await run(dir, "system", "list", "--json")).stdout,
    );
    assert.deepEqual(
      listed.data.items.find((item) => item.id === "pair").members,
      [{ device: "demo" }],
    );
    await run(dir, "system", "delete", "pair", "--json");
    const afterDelete = JSON.parse(
      (await run(dir, "system", "list", "--json")).stdout,
    );
    assert.equal(
      afterDelete.data.items.some((item) => item.id === "pair"),
      false,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

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
    assert.equal(machine.schema, "benchpilot.result");
    assert.equal(machine.version, 3);
    assert.equal(machine.kind, "help");
    assert.equal(machine.data.command.id, "root");
    assert.match(machine.data.summary.text, /Agent-first device lifecycle CLI/);
    assert.equal(machine.data.children.length, 14);
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
    const listedJson = JSON.parse(
      (await run(dir, "language", "list", "--json")).stdout,
    );
    assert.equal(listedJson.schema, "benchpilot.result");
    assert.equal(listedJson.version, 3);
    assert.equal(listedJson.command.id, "language.list");
    assert.equal(listedJson.data.schema, "benchpilot.language-list");
    const updated = await run(dir, "language", "set", "zh-CN");
    assert.equal(
      updated.stdout,
      "CLI 语言已更新\n  区域设置    zh-CN\n  语言        简体中文\n",
    );
    assert.match(
      await readFile(path.join(dir, ".benchpilot", "config.toml"), "utf8"),
      /locale = "zh-CN"/,
    );
    assert.equal(
      (await run(dir, "language", "get")).stdout,
      "当前 CLI 语言\n  区域设置    zh-CN\n  语言        简体中文\n",
    );
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
    assert.equal(machine.data.existing, true);
    assert.equal(machine.data.config.project.id, "existing-project");
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
    const checks = new Map(
      doctor.data.checks.map((check) => [check.id, check]),
    );
    assert.equal(checks.get("project-local").status, "pass");
    assert.equal(checks.get("adapters").status, "warn");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("root doctor localizes adapter diagnostics", async () => {
  const dir = await mkdtemp(
    path.join(os.tmpdir(), "benchpilot-doctor-adapter-"),
  );
  try {
    await initDemo(dir);
    await run(dir, "language", "set", "zh-CN");
    const output = await run(dir, "doctor");
    assert.match(output.stdout, /适配器包已准备就绪。/);
    assert.doesNotMatch(output.stdout, /Adapter bundle ready/);
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

test("home falls back to the ordinary root page when interaction is unavailable", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "benchpilot-home-"));
  try {
    const human = await run(dir, "home", "--agent");
    const root = await run(dir, "--agent");
    assert.equal(human.stdout, root.stdout);
    assert.match(human.stdout, /Agent-first device lifecycle CLI/);
    assert.match(human.stdout, /Open the guided interactive interface/);
    assert.match(human.stdout, /device\s+Discover, configure, and operate/);
    const machine = JSON.parse((await runAgent(dir, "home", "--json")).stdout);
    assert.equal(machine.schema, "benchpilot.result");
    assert.equal(machine.kind, "help");
    assert.equal(machine.data.command.id, "root");
    assert.equal(machine.data.view, "root-help");
    assert.doesNotMatch(
      JSON.stringify(machine),
      /agentPresentation|"view":"agent"/,
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
    assert.match(human.stdout, new RegExp(`BenchPilot v${packageVersion}`));
    const machine = JSON.parse((await run(dir, "version", "--json")).stdout);
    assert.equal(machine.schema, "benchpilot.result");
    assert.equal(machine.version, 3);
    assert.deepEqual(machine.command, { id: "version", path: ["version"] });
    assert.deepEqual(machine.data, {
      schema: "benchpilot.version",
      version: 1,
      cliVersion: packageVersion,
      nodeVersion: process.version,
    });
    const events = (await run(dir, "version", "--jsonl")).stdout
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.deepEqual(
      events.map((event) => event.event.type),
      ["command.started", "snapshot", "command.completed"],
    );
    assert.deepEqual(events.at(-1).event.result.data, machine.data);
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
    assert.equal(events[0].schema, "benchpilot.event");
    assert.equal(events[0].version, 3);
    assert.equal(events[0].event.type, "command.started");
    assert.equal(events.at(-1).event.type, "command.completed");
    assert.equal(events.at(-1).event.result.kind, "help");
    assert.deepEqual(
      events.map((event) => event.sequence),
      [0, 1, 2],
    );
    assert.equal(events[1].event.type, "snapshot");
    assert.equal(events[1].event.key, "help");
    const device = events[1].event.value.children.find(
      (entry) => entry.id === "device",
    );
    assert.equal(device.summary.key, "command.device.root");
    assert.doesNotMatch(raw, /\u001B\[/);
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
    assert.equal(root[0].event.type, "command.started");
    assert.equal(root.at(-1).event.result.kind, "help");
    const detailed = JSON.parse(
      (await runAgent(dir, "--help", "--json")).stdout,
    );
    const commands = detailed.data.children;
    assert.ok(commands.length);
    assert.match(JSON.stringify(commands), /command\.run\.root/);
    const version = JSON.parse(
      (await runAgent(dir, "version", "--help", "--json")).stdout,
    );
    assert.equal(version.kind, "help");
    assert.equal(version.data.command.id, "version");
    assert.deepEqual(version.data.usage, ["benchpilot version"]);
    const global = JSON.parse((await run(dir, "--version", "--json")).stdout);
    assert.equal(global.schema, "benchpilot.result");
    assert.equal(global.version, 3);
    assert.equal(global.data.cliVersion, packageVersion);
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
    assert.deepEqual(fromHelp.data, fromFlag.data);
    assert.equal(fromHelp.schema, "benchpilot.result");
    assert.equal(fromHelp.version, 3);
    assert.equal(fromHelp.kind, "help");
    assert.match(JSON.stringify(fromHelp.data), /benchpilot config get <key>/);
    assert.doesNotMatch(JSON.stringify(fromHelp.data), /visibility|lineBreak/);
    const helpCommand = JSON.parse(
      (await run(dir, "help", "--help", "--json")).stdout,
    );
    assert.equal(helpCommand.data.command.id, "help");
    assert.deepEqual(helpCommand.data.usage, ["benchpilot help [<path...>]"]);
    assert.deepEqual(helpCommand.data.output, {
      id: "help",
      schema: "benchpilot.help",
      version: 3,
      view: "help",
    });
    const complete = JSON.parse(
      (await run(dir, "help", "--all", "--json")).stdout,
    );
    assert.equal(complete.data.view, "all-help");
    assert.ok(
      complete.data.children.some(
        (child) => child.usage === "benchpilot language set <locale>",
      ),
    );
    const configGet = JSON.parse(
      (await run(dir, "help", "config", "get", "--json")).stdout,
    );
    assert.equal(configGet.data.output.schema, "benchpilot.config-get");
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
    assert.equal(result.schema, "benchpilot.result");
    assert.equal(result.data.schema, "benchpilot.lock-list");
    assert.deepEqual(result.data.locks, []);
    assert.deepEqual(
      result.data.corrupt.map((entry) => entry.id),
      ["invalid-owner"],
    );
    const inspection = await run(
      dir,
      "lock",
      "invalid-owner",
      "show",
      "--json",
    ).catch((error) => error);
    assert.equal(JSON.parse(inspection.stdout).error.kind, "LOCK_CORRUPT");
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
    assert.equal(listMachine.data.locks[0].liveness, "stale");
    assert.equal(listMachine.data.locks[0].state, "active");
    const listFrames = (await run(dir, "lock", "list", "--jsonl")).stdout
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.deepEqual(
      listFrames.map((frame) => frame.event.type),
      ["command.started", "snapshot", "command.completed"],
    );
    assert.equal(listFrames[1].event.key, `locks.${lockId}`);
    assert.deepEqual(listFrames[1].event.value, listMachine.data.locks[0]);
    assert.deepEqual(listFrames.at(-1).event.result.data, listMachine.data);
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
    assert.deepEqual(machine.data, {
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
    assert.equal(frames[0].schema, "benchpilot.event");
    assert.equal(frames[0].event.type, "command.started");
    assert.equal(frames[1].event.type, "snapshot");
    assert.equal(frames[1].event.key, "result");
    assert.deepEqual(frames[1].event.value, machine.data);
    const cleared = JSON.parse(
      (await run(dir, "lock", lockId, "clear", "--json")).stdout,
    );
    assert.deepEqual(cleared.data, {
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
    assert.equal(result.error.kind, "AGENT_INTERACTION_UNSUPPORTED");
    assert.equal(
      result.error.diagnosticId,
      "core.agent-interaction-unsupported",
    );
    assert.equal(machine.stderr, "");
    const stream = await runAgent(dir, "init", "--jsonl").catch(
      (error) => error,
    );
    const events = stream.stdout
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.deepEqual(
      events.map((event) => event.event.type),
      ["command.started", "command.failed"],
    );
    assert.equal(
      events[1].event.result.error.kind,
      "AGENT_INTERACTION_UNSUPPORTED",
    );
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
    assert.equal(result.error.kind, "AGENT_INTERACTION_UNSUPPORTED");
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
    assert.equal(result.error.kind, "AGENT_INTERACTION_UNSUPPORTED");
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
    assert.equal(result.kind, "interaction");
    assert.equal(result.error.kind, "AGENT_INTERACTION_UNSUPPORTED");
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
    assert.match((await run(dir, "help", "config")).stdout, /查看和管理配置/);
    assert.match(
      (await run(dir, "config", "--help")).stdout,
      /说明配置值的来源/,
    );
    const machine = JSON.parse((await run(dir, "--help", "--json")).stdout);
    assert.equal(machine.kind, "help");
    assert.equal(machine.data.summary.key, "help.group.root");
    assert.match(machine.data.summary.text, /面向 Agent 的设备生命周期 CLI/);
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
    assert.match(result.stdout, /命令/);
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
      assert.equal(JSON.parse(error.stdout).error.kind, "USAGE_ERROR");
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
    assert.ok(result.meta.runId);
    const built = await run(dir, "device", "demo", "build", "--json");
    assert.match(
      JSON.parse(built.stdout).data.artifacts[0].sha256,
      /^[a-f0-9]{64}$/,
    );
    const jsonl = await run(dir, "device", "demo", "deploy", "--jsonl");
    const events = jsonl.stdout
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.ok(
      events.every(
        (event) => event.schema === "benchpilot.event" && event.version === 3,
      ),
    );
    assert.equal(events.at(-1).event.type, "command.completed");
    assert.equal(
      events.filter((event) =>
        /command\.(completed|failed)/.test(event.event.type),
      ).length,
      1,
    );
    assert.ok(
      events.some((event) => event.event.type === "operation.stage.started"),
    );
    const commandJsonl = await run(dir, "config", "validate", "--jsonl");
    const commandEvents = commandJsonl.stdout
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.equal(commandEvents[0].schema, "benchpilot.event");
    assert.equal(commandEvents[0].event.type, "command.started");
    assert.deepEqual(commandEvents[1].event.value, { valid: true });
    const failedCommand = await run(dir, "config", "unknown", "--jsonl").catch(
      (error) => error,
    );
    const failedEvents = failedCommand.stdout
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.deepEqual(
      failedEvents.map((event) => event.event.type),
      ["command.started", "command.failed"],
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("configuration query commands use structured data pages", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "benchpilot-config-pages-"));
  try {
    await initDemo(dir);
    const resolved = JSON.parse(
      (await run(dir, "config", "resolved", "--json")).stdout,
    );
    assert.equal(resolved.data.schema, "benchpilot.config-resolved");
    assert.equal(resolved.data.config.project.name, "Demo");
    assert.equal(resolved.data.origins["project.name"].scope, "project");

    const resolvedScreen = await run(dir, "config", "resolved");
    assert.match(resolvedScreen.stdout, /\n  version\n    Value\s+1/);
    assert.doesNotMatch(resolvedScreen.stdout, /Key\s+Value\s+Origin/);

    const explanation = JSON.parse(
      (await run(dir, "config", "explain", "approval.level", "--json")).stdout,
    );
    assert.equal(explanation.data.schema, "benchpilot.config-explain");
    assert.equal(explanation.data.key, "approval.level");
    assert.ok(
      explanation.data.layers.some((layer) => layer.scope === "project-local"),
    );

    const screen = await run(dir, "config", "explain", "approval.level");
    assert.match(screen.stdout, /Configuration source/);
    assert.match(screen.stdout, /Configuration layers/);

    const updated = JSON.parse(
      (await run(dir, "config", "set", "project.name", "Updated", "--json"))
        .stdout,
    );
    assert.equal(updated.data.schema, "benchpilot.config-set");
    assert.equal(updated.data.key, "project.name");
    assert.equal(updated.data.value, "Updated");
    assert.equal(updated.data.scope, "project");

    const updateScreen = await run(
      dir,
      "config",
      "set",
      "project.name",
      "Updated",
    );
    assert.match(updateScreen.stdout, /Configuration updated/);
    assert.doesNotMatch(updateScreen.stdout, /"scope"/);

    const value = JSON.parse(
      (await run(dir, "config", "get", "project.name", "--json")).stdout,
    );
    assert.equal(value.data.schema, "benchpilot.config-get");
    assert.equal(value.data.value, "Updated");
    assert.equal(value.data.origin.scope, "project");

    const timeout = JSON.parse(
      (await run(dir, "config", "get", "defaults.timeout", "--json")).stdout,
    );
    assert.equal(timeout.data.origin.scope, "default");

    const removed = JSON.parse(
      (await run(dir, "config", "unset", "defaults.timeout", "--json")).stdout,
    );
    assert.equal(removed.data.schema, "benchpilot.config-unset");
    assert.equal(removed.data.scope, "local");

    const invalidScope = await run(
      dir,
      "config",
      "set",
      "project.name",
      "Invalid",
      "--local",
      "--json",
    ).catch((error) => error);
    assert.equal(
      JSON.parse(invalidScope.stdout).error.kind,
      "CONFIG_SCOPE_INVALID",
    );

    const unmanaged = await run(
      dir,
      "config",
      "get",
      "devices",
      "--json",
    ).catch((error) => error);
    assert.equal(
      JSON.parse(unmanaged.stdout).error.kind,
      "CONFIG_KEY_NOT_FOUND",
    );

    const frames = (await run(dir, "config", "resolved", "--jsonl")).stdout
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.equal(frames[0].schema, "benchpilot.event");
    assert.ok(
      frames.some((frame) => frame.event.key === "config.project.name"),
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("adapter enable and disable persist the current project selection", async () => {
  const dir = await mkdtemp(
    path.join(os.tmpdir(), "benchpilot-adapter-state-"),
  );
  try {
    await initDemo(dir);

    const disabled = JSON.parse(
      (await run(dir, "adapter", "demo", "disable", "--json")).stdout,
    );
    assert.deepEqual(disabled.data, {
      schema: "benchpilot.adapter-state",
      version: 1,
      adapter: "demo",
      enabled: false,
      changed: true,
      scope: "project",
      path: path.join(dir, "benchpilot.toml"),
      adapters: [],
    });
    assert.match(
      await readFile(path.join(dir, "benchpilot.toml"), "utf8"),
      /enabled = \[\s*\]/,
    );
    const doctorWhileDisabled = JSON.parse(
      (await run(dir, "adapter", "demo", "doctor", "--json")).stdout,
    );
    assert.equal(doctorWhileDisabled.data.schema, "benchpilot.adapter-doctor");
    const doctorScreen = await run(dir, "adapter", "demo", "doctor");
    assert.match(doctorScreen.stdout, /Adapter diagnostics/);
    const listedWhileDisabled = JSON.parse(
      (await run(dir, "adapter", "list", "--json")).stdout,
    );
    assert.equal(
      listedWhileDisabled.data.adapters.some(
        (adapter) => adapter.id === "demo",
      ),
      true,
    );

    const alreadyDisabled = JSON.parse(
      (await run(dir, "adapter", "demo", "disable", "--json")).stdout,
    );
    assert.equal(alreadyDisabled.data.changed, false);

    const enabled = JSON.parse(
      (await run(dir, "adapter", "demo", "enable", "--json")).stdout,
    );
    assert.equal(enabled.data.enabled, true);
    assert.equal(enabled.data.changed, true);
    assert.deepEqual(enabled.data.adapters, ["demo"]);
    assert.match(
      await readFile(path.join(dir, "benchpilot.toml"), "utf8"),
      /enabled = \[ "demo" \]/,
    );

    const alreadyEnabled = JSON.parse(
      (await run(dir, "adapter", "demo", "enable", "--json")).stdout,
    );
    assert.equal(alreadyEnabled.data.changed, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("adapter discover persists globally resolved tool paths", async () => {
  const dir = await mkdtemp(
    path.join(os.tmpdir(), "benchpilot-adapter-configure-"),
  );
  const globalConfig = path.join(dir, ".benchpilot", "config.toml");
  try {
    await initDemo(dir, { discover: false });
    const operationBeforeDiscovery = await run(
      dir,
      "device",
      "demo",
      "build",
      "--json",
    ).catch((error) => error);
    assert.equal(
      machineError(JSON.parse(operationBeforeDiscovery.stdout)).kind,
      "ADAPTER_TOOL_NOT_FOUND",
    );
    await run(dir, "adapter", "demo", "disable", "--json");
    const doctorBeforeDiscovery = JSON.parse(
      (await run(dir, "adapter", "demo", "doctor", "--json")).stdout,
    );
    assert.equal(
      doctorBeforeDiscovery.data.checks.find(
        (check) => check.id === "demo-tool-node",
      ).status,
      "fail",
    );
    const globalBeforeDiscovery = await readFile(globalConfig, "utf8");
    const discovered = JSON.parse(
      (await run(dir, "adapter", "demo", "discover", "--json")).stdout,
    );
    assert.equal(discovered.data.schema, "benchpilot.adapter-configuration");
    assert.equal(discovered.data.changed, true);
    assert.equal(typeof discovered.data.config.node_path, "string");
    assert.notEqual(
      await readFile(globalConfig, "utf8"),
      globalBeforeDiscovery,
    );
    assert.match(await readFile(globalConfig, "utf8"), /node_path = ".+"/);
    const doctor = JSON.parse(
      (await run(dir, "adapter", "demo", "doctor", "--json")).stdout,
    );
    assert.equal(
      doctor.data.configuration.node_path,
      discovered.data.config.node_path,
    );
    await run(dir, "adapter", "demo", "enable", "--json");
    assert.equal(
      JSON.parse((await run(dir, "device", "demo", "build", "--json")).stdout)
        .ok,
      true,
    );

    const discoveredAgain = JSON.parse(
      (await run(dir, "adapter", "demo", "discover", "--json")).stdout,
    );
    assert.equal(discoveredAgain.data.changed, false);
    assert.equal(discoveredAgain.data.tools[0].candidateId, "config");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("adapter configure validates and persists manual tool paths", async () => {
  const dir = await mkdtemp(
    path.join(os.tmpdir(), "benchpilot-adapter-configure-manual-"),
  );
  const globalConfig = path.join(dir, ".benchpilot", "config.toml");
  try {
    await initDemo(dir, { discover: false });
    const configured = JSON.parse(
      (
        await run(
          dir,
          "adapter",
          "demo",
          "configure",
          "--node_path",
          process.execPath,
          "--json",
        )
      ).stdout,
    );
    assert.equal(configured.data.schema, "benchpilot.adapter-configuration");
    assert.equal(configured.data.changed, true);
    assert.equal(configured.data.config.node_path, process.execPath);
    assert.match(await readFile(globalConfig, "utf8"), /node_path = ".+"/);

    const configuredAgain = JSON.parse(
      (
        await run(
          dir,
          "adapter",
          "demo",
          "configure",
          "--node_path",
          process.execPath,
          "--json",
        )
      ).stdout,
    );
    assert.equal(configuredAgain.data.changed, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("adapter configure help lists adapter-specific path options", async () => {
  const dir = await mkdtemp(
    path.join(os.tmpdir(), "benchpilot-adapter-configure-help-"),
  );
  try {
    await initDemo(dir, { discover: false });
    const output = await run(dir, "adapter", "demo", "configure", "--help");
    assert.match(output.stdout, /--node_path <path>/);
    assert.doesNotMatch(output.stdout, /--set/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("adapter configure does not partially write global configuration", async () => {
  const dir = await mkdtemp(
    path.join(os.tmpdir(), "benchpilot-adapter-configure-failure-"),
  );
  const globalConfig = path.join(dir, ".benchpilot", "config.toml");
  try {
    await initDemo(dir, { discover: false });
    const before = await readFile(globalConfig, "utf8");
    const failed = await run(
      dir,
      "adapter",
      "demo",
      "configure",
      "--node_path",
      "missing-node-path",
      "--json",
    ).catch((error) => error);
    assert.equal(
      JSON.parse(failed.stdout).error.kind,
      "ADAPTER_CONFIGURATION_INCOMPLETE",
    );
    assert.equal(await readFile(globalConfig, "utf8"), before);
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
    assert.equal(adapters.data.schema, "benchpilot.adapter-list");
    assert.equal(
      adapters.data.adapters.some((adapter) => adapter.id === "demo"),
      true,
    );
    const built = JSON.parse(
      (await run(dir, "device", "demo", "build", "--json")).stdout,
    );
    assert.equal(built.ok, true);
    assert.equal(built.data.subject.capability, "build");
    assert.match(built.data.artifacts[0].sha256, /^[a-f0-9]{64}$/);
    const deployed = JSON.parse(
      (await run(dir, "device", "demo", "deploy", "--json")).stdout,
    );
    assert.equal(deployed.data.subject.capability, "deploy");
    assert.deepEqual(
      JSON.parse((await run(dir, "approval", "list", "--json")).stdout).data
        .approvals,
      [],
    );
    const lines = (
      await run(dir, "device", "demo", "capture", "--jsonl")
    ).stdout
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.equal(lines.at(-1).event.type, "command.completed");
    assert.equal(
      lines.filter((line) =>
        /command\.(completed|failed)/.test(line.event.type),
      ).length,
      1,
    );
    assert.equal(lines.at(-1).event.result.data.output.telemetry, 42);
    const runList = JSON.parse(
      (await run(dir, "run", "list", "--json")).stdout,
    );
    assert.equal(runList.data.schema, "benchpilot.run-list");
    assert.equal(runList.data.runs[0].status, "succeeded");
    assert.equal(runList.data.runs[0].command, "device.capture");
    const runId = runList.data.runs[0].id;
    const runDetail = JSON.parse(
      (await run(dir, "run", runId, "show", "--json")).stdout,
    );
    assert.equal(runDetail.data.schema, "benchpilot.run-detail");
    assert.equal(runDetail.data.run.id, runId);
    const runFrames = (await run(dir, "run", "list", "--jsonl")).stdout
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.equal(runFrames[0].schema, "benchpilot.event");
    assert.equal(runFrames[0].event.type, "command.started");
    assert.match(runFrames[1].event.key, /^runs\./);
    const inspection = JSON.parse(
      (await run(dir, "device", "demo", "inspect", "--json")).stdout,
    );
    assert.equal(inspection.ok, true);
    assert.equal(inspection.data.subject.capability, "inspect");
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
    await run(dir, "config", "set", "approval.level", "strict");
    const pendingDangerous = await run(
      dir,
      "device",
      "demo",
      "dangerous-reset",
      "--confirm-dangerous-reset",
      "--json",
    ).catch((error) => error);
    assert.equal(
      machineError(JSON.parse(pendingDangerous.stdout)).kind,
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
    assert.equal(dangerous.ok, true);
    assert.equal(dangerous.data.subject.capability, "dangerous-reset");
    const doctor = JSON.parse(
      (await run(dir, "adapter", "demo", "doctor", "--json")).stdout,
    );
    assert.equal(doctor.data.schema, "benchpilot.adapter-doctor");
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
    const requested = machineError(JSON.parse(pending.stdout));
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
    assert.equal(
      machineError(JSON.parse(different.stdout)).kind,
      "HUMAN_APPROVAL_REQUIRED",
    );
  } finally {
    await rm(dir, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
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
    await run(dir, "adapter", "demo", "discover", "--json");
    const child = spawn(
      process.execPath,
      [cli, "device", "demo", "deploy", "--jsonl"],
      {
        cwd: dir,
        env: cliEnv(dir),
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
    assert.match(firstOutput, /command\.started/);
    assert.equal(exited, false);
    await new Promise((resolve, reject) => {
      child.once("close", (code) => (code === 0 ? resolve() : reject(code)));
    });
  } finally {
    await rm(dir, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
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
    assert.ok(
      events.some((event) => event.event.type === "operation.stage.failed"),
    );
    assert.ok(
      events.some((event) => event.event.type === "operation.cleanup.started"),
    );
    assert.ok(
      events.some(
        (event) => event.event.type === "operation.cleanup.completed",
      ),
    );
    assert.equal(events.at(-1).event.type, "command.failed");
    assert.equal(
      events.filter((event) =>
        /command\.(completed|failed)/.test(event.event.type),
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
    await run(dir, "adapter", "demo", "discover", "--json");
    const failed = await run(
      dir,
      "device",
      "demo",
      "build",
      "--timeout",
      "10ms",
      "--json",
    ).catch((error) => error);
    assert.equal(
      machineError(JSON.parse(failed.stdout)).kind,
      "OPERATION_TIMEOUT",
    );
    assert.equal(
      machineError(JSON.parse(failed.stdout)).diagnosticId,
      "core.operation-timeout",
    );
    assert.deepEqual(
      JSON.parse((await run(dir, "lock", "list", "--json")).stdout).data.locks,
      [],
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("system JSONL emits child device events and one canonical terminal result", async () => {
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
        'members = [{ device = "left" }, { device = "right" }]',
      ].join("\n"),
    );
    await run(dir, "adapter", "demo", "discover", "--json");
    const output = await run(dir, "system", "test", "deploy", "--jsonl");
    const events = output.stdout
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.equal(events[0].event.type, "command.started");
    assert.equal(events.at(-1).event.type, "command.completed");
    assert.equal(
      events.filter((event) => event.event.type === "command.completed").length,
      1,
    );
    assert.equal(events.at(-1).event.result.kind, "operation");
    assert.equal(events.at(-1).event.result.data.subject.scope, "system");
    assert.ok(
      events.some(
        (event) =>
          event.event.type === "operation.device.completed" &&
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
        'members = [{ device = "fast" }, { device = "slow" }]',
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
    assert.equal(events.at(-1).event.type, "command.failed");
    assert.equal(
      events.filter((event) => event.event.type === "command.failed").length,
      1,
    );
    assert.equal(events.at(-1).event.result.kind, "operation");
    assert.equal(events.at(-1).event.result.data.execution.status, "failed");
    const slowCompleted = events.findIndex(
      (event) =>
        event.event.type === "operation.device.completed" &&
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
    assert.equal(JSON.parse(result.stdout).data.output.echoed, "ok");
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
    assert.equal(plan.data.execution.dryRun, true);
    const dryRunEvents = (
      await run(dir, "device", "demo", "build", "--dry-run", "--jsonl")
    ).stdout
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.deepEqual(
      dryRunEvents.map((event) => event.event.type),
      ["command.started", "command.completed"],
    );
    assert.equal(dryRunEvents.at(-1).event.result.ok, true);
    assert.equal(dryRunEvents.at(-1).event.result.kind, "operation");
    assert.equal(dryRunEvents.at(-1).event.result.data.execution.dryRun, true);
    assert.deepEqual(
      JSON.parse((await run(dir, "run", "list", "--json")).stdout).data.runs,
      [],
    );
    assert.deepEqual(
      JSON.parse((await run(dir, "lock", "list", "--json")).stdout).data.locks,
      [],
    );
    assert.deepEqual(
      JSON.parse((await run(dir, "approval", "list", "--json")).stdout).data
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
    assert.equal(list.data.schema, "benchpilot.approval-list");
    assert.equal(list.data.approvals[0].id, approval.id);
    assert.equal(
      list.data.approvals[0].binding.device.physicalId,
      "demo-device-01",
    );
    const events = (await run(dir, "approval", "list", "--jsonl")).stdout
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.deepEqual(
      events.map((event) => event.event.type),
      ["command.started", "snapshot", "command.completed"],
    );
    assert.equal(events[1].event.key, `approvals.${approval.id}`);
    const detail = await run(dir, "approval", approval.id, "inspect");
    assert.match(detail.stdout, /Approval details/);
    assert.match(detail.stdout, /Deploy/);
    assert.match(detail.stdout, /Demo/);
    assert.match(detail.stdout, /demo-device-01/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
