import assert from "node:assert/strict";
import test from "node:test";
import {
  access,
  mkdtemp,
  readFile,
  rm,
  writeFile,
  mkdir,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { BenchPilotError, PathService } from "../dist/index.js";
import { loadApplicationConfig } from "../dist/application/config/loader.js";
import { initializeProject } from "../dist/application/init/use-case.js";
import { CommandCatalog } from "../dist/application/commands/catalog.js";
import { configurationKeyPaths } from "../dist/application/queries/use-case.js";
import { ConfigurationCommandUseCases } from "../dist/application/config/command-use-case.js";
import { RuntimeCommandUseCases } from "../dist/application/runtime/command-use-case.js";
import {
  executeSystemCapability,
  SystemUseCases,
  systemCapabilityIntersection,
} from "../dist/application/systems/use-case.js";

test("command catalog derives device and system choices without executing operations", async () => {
  let capabilityQueries = 0;
  const catalog = new CommandCatalog({
    async configuredDevices() {
      return [{ id: "device-a" }];
    },
    async configuredSystems() {
      return [{ id: "system-a" }];
    },
    async deviceCapabilities() {
      capabilityQueries += 1;
      return [{ id: "status", summary: "read status" }];
    },
    async systemCapabilities() {
      capabilityQueries += 1;
      return [{ id: "status", summary: "read status" }];
    },
  });
  assert.deepEqual(
    (await catalog.children(["device"])).map((node) => node.path),
    [["device", "device-a"]],
  );
  assert.deepEqual(
    (await catalog.children(["system", "system-a"])).map((node) => ({
      id: node.id,
      handler: node.handler,
    })),
    [{ id: "system.system-a.status", handler: "system.execute" }],
  );
  assert.equal(capabilityQueries, 1);
});

test("command catalog reloads dynamic capabilities before execution", async () => {
  let current = ["status"];
  const catalog = new CommandCatalog({
    async configuredDevices() {
      return [{ id: "device-a" }];
    },
    async configuredSystems() {
      return [];
    },
    async deviceCapabilities() {
      return current.map((id) => ({ id, summary: id }));
    },
    async systemCapabilities() {
      return [];
    },
  });
  assert.equal(
    (await catalog.executable(["device", "device-a", "status"])).handler,
    "device.execute",
  );
  current = [];
  await assert.rejects(
    catalog.executable(["device", "device-a", "status"]),
    (error) =>
      error instanceof BenchPilotError &&
      error.kind === "UNSUPPORTED_CAPABILITY",
  );
});

test("command catalog preserves read-only capability safety metadata", async () => {
  const capability = {
    id: "deploy",
    summary: "deploy firmware",
    options: [
      {
        name: "target",
        summary: "deployment target",
        required: true,
        schema: { type: "string" },
        aliases: ["t"],
      },
    ],
    inputSchema: { type: "object", properties: { target: { type: "string" } } },
    outputSchema: { type: "object" },
    defaultTimeoutMs: 60_000,
    lockMode: "exclusive",
    createsRun: true,
    safety: { mode: "danger-flag", flag: "confirm-deploy" },
    availability: "available",
  };
  const catalog = new CommandCatalog({
    async configuredDevices() {
      return [{ id: "device-a" }];
    },
    async configuredSystems() {
      return [];
    },
    async deviceCapabilities() {
      return [capability];
    },
    async systemCapabilities() {
      return [];
    },
  });
  const [node] = await catalog.children(["device", "device-a"]);
  assert.deepEqual(
    {
      handler: node.handler,
      lockMode: node.lockMode,
      defaultTimeoutMs: node.defaultTimeoutMs,
      safety: node.safety,
      inputSchema: node.inputSchema,
      option: {
        name: node.options[0].name,
        summary: node.options[0].summary,
        required: node.options[0].required,
        schema: node.options[0].schema,
        aliases: node.options[0].aliases,
      },
    },
    {
      handler: "device.execute",
      lockMode: "exclusive",
      defaultTimeoutMs: 60_000,
      safety: { mode: "danger-flag", flag: "confirm-deploy" },
      inputSchema: capability.inputSchema,
      option: capability.options[0],
    },
  );
});

test("configuration key selectors expose stable existing leaf paths", () => {
  assert.deepEqual(
    configurationKeyPaths({
      project: { name: "Demo", tags: ["fixture"] },
      adapters: { demo: {} },
      version: 1,
    }),
    ["adapters.demo", "project.name", "project.tags", "version"],
  );
});

test("configuration command use case owns action validation and mutation input", async () => {
  const edits = [];
  const commands = new ConfigurationCommandUseCases(
    {
      getConfiguration(key, showOrigin) {
        return {
          key,
          value: "value",
          origin: showOrigin ? { scope: "local" } : undefined,
        };
      },
      resolvedConfiguration() {
        return { config: { version: 1 }, origins: {} };
      },
      explainConfiguration(key) {
        return { key, layers: [] };
      },
      validateConfiguration() {
        return { valid: true };
      },
    },
    {
      async edit(input) {
        edits.push(input);
        return { ...input, changed: true };
      },
    },
  );
  assert.deepEqual(
    await commands.execute({ action: "get", key: "project.name", scopes: [] }),
    {
      kind: "config.get",
      data: { key: "project.name", value: "value", origin: undefined },
    },
  );
  await assert.rejects(
    commands.execute({ action: "set", key: "project.name", scopes: [] }),
    (error) => error instanceof BenchPilotError && error.kind === "USAGE_ERROR",
  );
  await assert.rejects(
    commands.execute({ action: "unknown", scopes: [] }),
    (error) => error instanceof BenchPilotError && error.kind === "USAGE_ERROR",
  );
  const outcome = await commands.execute({
    action: "set",
    key: "project.name",
    value: "Demo",
    scopes: ["local"],
  });
  assert.equal(outcome.kind, "config.set");
  assert.deepEqual(edits, [
    {
      scopes: ["local"],
      key: "project.name",
      value: "Demo",
    },
  ]);
});

test("runtime command use case owns administrative action dispatch", async () => {
  const calls = [];
  const commands = new RuntimeCommandUseCases({
    async listRuns(input) {
      calls.push(["listRuns", input]);
      return { runs: [] };
    },
    async pruneRuns(input) {
      calls.push(["pruneRuns", input]);
      return { removed: [] };
    },
    async showRun(id) {
      return { id };
    },
    async runLog(id) {
      return { log: id };
    },
    async runArtifacts(id) {
      return { artifacts: [id] };
    },
    async listLocks() {
      return { locks: [] };
    },
    async clearStaleLocks() {
      return { cleared: [] };
    },
    async inspectLock(id) {
      return { id };
    },
    async clearLock(id, input) {
      calls.push(["clearLock", id, input]);
      return { cleared: id };
    },
    async listApprovals() {
      return { approvals: [] };
    },
    async inspectApproval(id) {
      return { id };
    },
    async rejectApproval(id) {
      return { id, status: "rejected" };
    },
    async approvalChallenge(id) {
      return { id, physicalId: "serial-1" };
    },
    async approveApproval(id) {
      calls.push(["approve", id]);
      return { id, status: "approved" };
    },
  });
  assert.deepEqual(
    await commands.execute({
      action: "runs.list",
      limit: "2",
    }),
    { kind: "runtime.runs.list", data: { runs: [] } },
  );
  assert.deepEqual(calls[0], ["listRuns", { status: undefined, limit: 2 }]);
  assert.deepEqual(
    await commands.execute({
      action: "approval.approve",
      id: "a",
    }),
    { kind: "runtime.approval.approve", data: { id: "a", status: "approved" } },
  );
  assert.deepEqual(calls.at(-1), ["approve", "a"]);
});

test("init creates the minimum project files and applies an existing configuration on repeat", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "benchpilot-init-"));
  try {
    const result = await initializeProject({
      cwd,
      projectName: "Demo project",
      enabledAdapters: [],
    });
    assert.equal(result.existing, false);
    assert.match(result.project.id, /^project-[0-9a-f-]{36}$/);
    assert.equal(result.project.name, "Demo project");
    const config = path.join(cwd, "benchpilot.toml");
    const local = path.join(cwd, ".benchpilot", "config.local.toml");
    const gitignore = path.join(cwd, ".benchpilot", ".gitignore");
    assert.match(
      await readFile(config, "utf8"),
      /id = "project-[0-9a-f-]{36}"/,
    );
    assert.match(await readFile(config, "utf8"), /enabled = \[ ?\]/);
    assert.match(await readFile(local, "utf8"), /level = "default"/);
    assert.equal(await readFile(gitignore, "utf8"), "*\n!.gitignore\n");
    const paths = new PathService(
      { TEMP: path.join(cwd, "runtime") },
      "win32",
      cwd,
    );
    const resolved = await loadApplicationConfig(
      paths,
      await paths.project(cwd),
    );
    assert.equal(resolved.value.approval.level, "default");
    assert.equal(resolved.value.cli, undefined);
    const before = await readFile(config, "utf8");
    const repeated = await initializeProject({
      cwd,
      projectName: "Other",
      enabledAdapters: [],
    });
    assert.equal(repeated.existing, true);
    assert.deepEqual(repeated.config, {
      version: 1,
      project: { id: result.project.id, name: "Demo project" },
      adapters: { enabled: [] },
    });
    assert.equal(await readFile(config, "utf8"), before);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("init refuses to overwrite local initialization files before creating a project", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "benchpilot-init-target-"));
  try {
    await mkdir(path.join(cwd, ".benchpilot"));
    const local = path.join(cwd, ".benchpilot", "config.local.toml");
    await writeFile(local, '[cli]\nlocale = "en"\n');
    await assert.rejects(
      initializeProject({
        cwd,
        projectName: "Demo",
        enabledAdapters: [],
      }),
      (error) =>
        error instanceof BenchPilotError && error.kind === "INIT_TARGET_EXISTS",
    );
    await assert.rejects(access(path.join(cwd, "benchpilot.toml")));
    assert.match(await readFile(local, "utf8"), /locale = "en"/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("init adopts an existing project file and creates its local directory", async () => {
  const cwd = await mkdtemp(
    path.join(os.tmpdir(), "benchpilot-init-existing-"),
  );
  try {
    const config = path.join(cwd, "benchpilot.toml");
    await writeFile(
      config,
      'version = 1\n[project]\nid = "legacy-project"\nname = "Legacy project"\n[adapters]\nenabled = ["esp-idf"]\n',
    );
    const before = await readFile(config, "utf8");
    const result = await initializeProject({
      cwd,
      projectName: "Ignored",
      enabledAdapters: [],
    });
    assert.equal(result.existing, true);
    assert.equal(result.project.id, "legacy-project");
    assert.deepEqual(result.adapters.enabled, ["esp-idf"]);
    assert.equal(await readFile(config, "utf8"), before);
    assert.match(
      await readFile(
        path.join(cwd, ".benchpilot", "config.local.toml"),
        "utf8",
      ),
      /level = "default"/,
    );
    assert.equal(
      await readFile(path.join(cwd, ".benchpilot", ".gitignore"), "utf8"),
      "*\n!.gitignore\n",
    );
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("system capability preflight rejects before any member executes", async () => {
  const executed = [];
  const runner = {
    async listCapabilities(device) {
      return device === "first"
        ? [
            {
              id: "deploy",
              summary: "deploy",
              lockMode: "exclusive",
              safety: { mode: "normal" },
            },
          ]
        : [
            {
              id: "status",
              summary: "status",
              lockMode: "none",
              safety: { mode: "normal" },
            },
          ];
    },
    async execute(device) {
      executed.push(device);
      return { ok: true };
    },
    async preflightApproval() {
      return { required: false };
    },
  };
  assert.deepEqual(
    await systemCapabilityIntersection({
      devices: ["first", "second"],
      runner,
    }),
    [],
  );
  await assert.rejects(
    executeSystemCapability({
      system: "fixture",
      capability: "deploy",
      devices: ["first", "second"],
      runner,
    }),
    (error) =>
      error instanceof BenchPilotError &&
      error.kind === "SYSTEM_CAPABILITY_UNAVAILABLE",
  );
  assert.deepEqual(executed, []);
});

test("system capability definition is read only after safe intersection", async () => {
  const selected = [];
  const definition = {
    id: "deploy",
    summary: "deploy",
    defaultTimeoutMs: 60_000,
    lockMode: "exclusive",
    createsRun: true,
    safety: { mode: "danger-flag", flag: "confirm-deploy" },
    options: [],
    execute: async () => ({}),
  };
  const systems = new SystemUseCases({
    config: {
      value: {
        systems: {
          fixture: {
            members: [{ device: "second" }, { device: "first" }],
          },
        },
      },
      origins: new Map(),
      layers: [],
    },
    runner: {
      async listCapabilities() {
        return [
          {
            id: "deploy",
            summary: "deploy",
            defaultTimeoutMs: 60_000,
            lockMode: "exclusive",
            safety: { mode: "danger-flag", flag: "confirm-deploy" },
            options: [],
          },
        ];
      },
    },
    devices: {
      async capability(device, capability) {
        selected.push({ device, capability });
        return { capability: definition };
      },
    },
  });
  assert.equal(await systems.capability("fixture", "deploy"), definition);
  assert.deepEqual(selected, [{ device: "first", capability: "deploy" }]);
});

test("system capabilities use the display locale of a compatible member", async () => {
  const systems = new SystemUseCases({
    config: {
      value: { systems: { fixture: { members: [{ device: "first" }] } } },
      origins: new Map(),
      layers: [],
    },
    runner: {
      async listCapabilities() {
        return [
          {
            id: "build",
            summary: "Build firmware.",
            defaultTimeoutMs: 60_000,
            lockMode: "none",
            createsRun: true,
            safety: { mode: "normal" },
            options: [],
          },
        ];
      },
    },
    devices: {
      async describe(device, locale) {
        assert.equal(device, "first");
        assert.equal(locale, "zh-CN");
        return {
          capabilities: [{ id: "build", summary: "构建固件。" }],
        };
      },
    },
  });
  const result = await systems.describe("fixture", "zh-CN");
  assert.equal(result.capabilities[0].summary, "构建固件。");
});

test("system status executes its safe intersection in parallel", async () => {
  const runner = {
    async listCapabilities() {
      return [
        {
          id: "status",
          summary: "status",
          lockMode: "none",
          safety: { mode: "normal" },
        },
      ];
    },
    async execute(device, capability, input) {
      assert.equal(capability, "status");
      assert.notEqual(input, undefined);
      return { device };
    },
    async preflightApproval() {
      return { required: false };
    },
  };
  const result = await executeSystemCapability({
    system: "fixture",
    capability: "status",
    devices: ["second", "first"],
    runner,
  });
  assert.equal(result.policy, "parallel");
  assert.deepEqual(result.results.map((entry) => entry.device).sort(), [
    "first",
    "second",
  ]);
});

test("system approval preflight requests every member before execution", async () => {
  const executed = [];
  const approvals = [];
  const runner = {
    async listCapabilities() {
      return [
        {
          id: "erase",
          summary: "erase",
          lockMode: "exclusive",
          safety: { mode: "human-approval", flag: "approve-erase" },
        },
      ];
    },
    async preflightApproval(device) {
      approvals.push(device);
      return {
        required: true,
        ready: false,
        approvalId: `approval-${device}`,
      };
    },
    async execute(device) {
      executed.push(device);
      return { device };
    },
  };
  await assert.rejects(
    executeSystemCapability({
      system: "fixture",
      capability: "erase",
      devices: ["second", "first"],
      runner,
    }),
    (error) =>
      error instanceof BenchPilotError &&
      error.kind === "HUMAN_APPROVAL_REQUIRED" &&
      error.details.approvalIds.join(",") === "approval-first,approval-second",
  );
  assert.deepEqual(approvals, ["first", "second"]);
  assert.deepEqual(executed, []);
});

test("interactive system execution does not create agent approval preflights", async () => {
  const executed = [];
  const runner = {
    async listCapabilities() {
      return [
        {
          id: "reset",
          summary: "reset",
          lockMode: "exclusive",
          safety: { mode: "caution" },
        },
      ];
    },
    async preflightApproval() {
      throw new Error("interactive execution must not preflight approvals");
    },
    async execute(device) {
      executed.push(device);
      return { device };
    },
  };
  const result = await executeSystemCapability({
    system: "fixture",
    capability: "reset",
    devices: ["second", "first"],
    runner,
    executionMode: "interactive",
  });
  assert.equal(
    result.results.every((member) => member.ok),
    true,
  );
  assert.deepEqual(executed, ["first", "second"]);
});
