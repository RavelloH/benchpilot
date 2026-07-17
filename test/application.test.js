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
import { BenchPilotError, loadConfig, PathService } from "../dist/index.js";
import { initializeProject } from "../dist/application/init/use-case.js";
import { CommandCatalog } from "../dist/application/commands/catalog.js";
import { configurationKeyPaths } from "../dist/application/queries/use-case.js";
import {
  executeSystemCapability,
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

test("init creates the minimum project files and preserves them on repeat", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "benchpilot-init-"));
  try {
    const result = await initializeProject({
      cwd,
      projectId: "demo",
      projectName: "Demo project",
      locale: "zh-CN",
    });
    assert.deepEqual(result.project, { id: "demo", name: "Demo project" });
    const config = path.join(cwd, "benchpilot.toml");
    const local = path.join(cwd, ".benchpilot", "config.local.toml");
    const gitignore = path.join(cwd, ".benchpilot", ".gitignore");
    assert.match(await readFile(config, "utf8"), /id = "demo"/);
    assert.match(await readFile(local, "utf8"), /locale = "zh-CN"/);
    assert.equal(await readFile(gitignore, "utf8"), "*\n!.gitignore\n");
    const paths = new PathService({ BENCHPILOT_HOME: path.join(cwd, "home") });
    const resolved = await loadConfig(paths, await paths.project(cwd));
    assert.equal(resolved.value.cli.locale, "zh-CN");
    assert.equal(resolved.origins.get("cli.locale")?.scope, "project-local");
    const before = await readFile(config, "utf8");
    await assert.rejects(
      initializeProject({
        cwd,
        projectId: "other",
        projectName: "Other",
        locale: "en",
      }),
      (error) =>
        error instanceof BenchPilotError && error.kind === "CONFIG_EXISTS",
    );
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
        projectId: "demo",
        projectName: "Demo",
        locale: "en",
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
