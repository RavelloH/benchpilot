import test from "node:test";
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import {
  AdapterRegistry,
  acquireFileGuard,
  ArtifactRegistry,
  abortPromise,
  approvalLevel,
  ApprovalManager,
  atomicJson,
  booleanSchema,
  durationSchema,
  enumSchema,
  BenchPilotError,
  PathService,
  RunManager,
  SchemaValidationError,
  lockIdentity,
  isSupportedNodeVersion,
  LockManager,
  objectSchema,
  OperationRunner,
  OperationSession,
  redactResolvedConfig,
  readJson,
  runProcess,
  startProcess,
  setKey,
  requiresApproval,
  stringSchema,
} from "../dist/index.js";
import { loadApplicationConfig } from "../dist/application/config/loader.js";

test("operation sessions only allow the lifecycle order", () => {
  const session = new OperationSession("device.fixture");
  assert.equal(session.state, "created");
  session.transition("prepared");
  session.transition("running");
  session.transition("cleaning");
  session.transition("finalized");
  assert.throws(
    () => session.transition("running"),
    (error) =>
      error instanceof BenchPilotError &&
      error.kind === "OPERATION_SESSION_STATE_INVALID",
  );
});

test("core errors have stable diagnostic ids and JSON-safe details", () => {
  const details = { bigint: 42n, nested: { error: new Error("fixture") } };
  details.circular = details;
  const error = new BenchPilotError(
    "DEVICE_BUSY",
    4,
    "Device is busy.",
    false,
    undefined,
    [],
    details,
  );
  assert.equal(error.diagnosticId, "core.device-busy");
  assert.deepEqual(error.details, {
    bigint: "42",
    nested: { error: { name: "Error", message: "fixture" } },
    circular: "[Circular]",
  });
  assert.doesNotThrow(() => JSON.stringify(error.details));
});

const exec = promisify(execFile);

const recordingBusinessLogs = {
  open() {
    return {
      debug() {},
      info() {},
      warn() {},
      event() {},
      async close() {},
    };
  },
};

test("core hardening uses safe lock names and redacts config", () => {
  const id = lockIdentity({
    adapter: "demo",
    kind: "device",
    physicalId: "COM1:../../bad\\name",
  });
  assert.match(id, /^[a-zA-Z0-9_-]+$/);
  assert.equal(
    redactResolvedConfig({ api_key: "private", visible: true }).api_key,
    "[REDACTED]",
  );
  assert.throws(
    () => setKey({}, "__proto__.polluted", true),
    (error) =>
      error instanceof BenchPilotError && error.kind === "INVALID_CONFIG",
  );
});

test("global configuration and project state use their dedicated roots", () => {
  for (const platform of ["win32", "darwin", "linux"]) {
    const home = path.join(os.tmpdir(), `benchpilot-${platform}-home`);
    const paths = new PathService(
      {
        LOCALAPPDATA: path.join(home, "ignored-local-app-data"),
        XDG_CONFIG_HOME: path.join(home, "ignored-config"),
        XDG_STATE_HOME: path.join(home, "ignored-state"),
        TEMP: path.join(home, "runtime-temp"),
      },
      platform,
      home,
      path.join(home, "fallback-temp"),
    );
    assert.equal(
      paths.globalConfig(),
      path.join(home, ".benchpilot", "config.toml"),
    );
    const project = path.join(home, "project");
    assert.equal(
      paths.projectStateRoot(project),
      path.join(project, ".benchpilot", "state"),
    );
    assert.equal(
      paths.approvalsRoot(project),
      path.join(project, ".benchpilot", "state", "approvals"),
    );
    assert.equal(
      paths.runsRoot(project),
      path.join(project, ".benchpilot", "state", "runs"),
    );
  }
});

test("project state and runtime locks are isolated", () => {
  const root = path.join(os.tmpdir(), "benchpilot-project-root");
  const paths = new PathService({ TEMP: path.join(root, "runtime") }, "win32");
  assert.equal(
    paths.runsRoot(root),
    path.join(root, ".benchpilot", "state", "runs"),
  );
  assert.equal(
    paths.runtimeRoot(),
    path.join(root, "runtime", "benchpilot", "locks"),
  );
});

test("BENCHPILOT_ environment configuration preserves the first key segment", async () => {
  const root = path.join(os.tmpdir(), "benchpilot-env-config");
  const config = await loadApplicationConfig(
    new PathService(
      {
        BENCHPILOT_DEVICES__ESP32S3: '{"adapter":"esp-idf","port":"COM8"}',
      },
      process.platform,
      root,
      root,
    ),
    undefined,
  );
  assert.deepEqual(config.value.devices, {
    esp32s3: { adapter: "esp-idf", port: "COM8" },
  });
  assert.equal(
    config.origins.get("devices.esp32s3.port")?.scope,
    "environment",
  );
});

test("approval levels use default as the normal project policy", () => {
  assert.equal(approvalLevel({}), "default");
  assert.equal(requiresApproval("strict", "caution"), true);
  assert.equal(requiresApproval("strict", "destructive"), true);
  assert.equal(requiresApproval("strict", "irreversible"), true);
  assert.equal(requiresApproval("default", "caution"), false);
  assert.equal(requiresApproval("default", "destructive"), false);
  assert.equal(requiresApproval("default", "irreversible"), true);
  assert.equal(requiresApproval("bypass", "irreversible"), false);
});

test("approval guards are project-local while lock guards use runtime state", () => {
  const home = path.join(os.tmpdir(), "benchpilot-guard-home");
  const first = new PathService(
    { TEMP: path.join(os.tmpdir(), "benchpilot-first-temp") },
    "win32",
    home,
  );
  const second = new PathService(
    { TEMP: path.join(os.tmpdir(), "benchpilot-second-temp") },
    "win32",
    home,
  );
  const project = path.join(home, "project");
  assert.equal(
    first.approvalGuardsRoot(project),
    second.approvalGuardsRoot(project),
  );
  assert.notEqual(first.lockGuardsRoot(), second.lockGuardsRoot());
});

test("node doctor version support starts at Node.js 22.13", () => {
  assert.equal(isSupportedNodeVersion("22.12.9"), false);
  assert.equal(isSupportedNodeVersion("22.13.0"), true);
  assert.equal(isSupportedNodeVersion("23.0.0"), true);
  assert.equal(isSupportedNodeVersion("24.0.0"), true);
});

test("runtime schemas validate values with stable errors", () => {
  assert.equal(durationSchema().parse("2s"), 2000);
  assert.throws(
    () => durationSchema().parse("soon"),
    (error) => error instanceof SchemaValidationError,
  );
  assert.equal(enumSchema(["debug", "info"]).parse("debug"), "debug");
});

test("process runner aborts without invoking a shell", async () => {
  const controller = new AbortController();
  const pending = runProcess({
    command: process.execPath,
    args: ["-e", "setTimeout(() => {}, 10000)"],
    signal: controller.signal,
    gracefulKillMs: 100,
    forceKillMs: 100,
  });
  setTimeout(() => controller.abort(new Error("test abort")), 25);
  await assert.rejects(
    pending,
    process.platform === "win32"
      ? /test abort|PROCESS_CLEANUP_TIMEOUT/
      : /test abort/,
  );
});

test("process runner rejects before spawn when its signal is already aborted", async () => {
  const controller = new AbortController();
  controller.abort(new Error("already aborted"));
  await assert.rejects(
    runProcess({
      command: process.execPath,
      args: ["-e", "throw new Error('must not run')"],
      signal: controller.signal,
    }),
    /already aborted/,
  );
});

test("process runner stop is idempotent after normal completion", async () => {
  const started = startProcess({
    command: process.execPath,
    args: ["-e", "process.exit(0)"],
    signal: new AbortController().signal,
  });
  await started.result;
  assert.equal(started.state, "exited");
  await started.stop();
  await started.stop();
  assert.equal(started.state, "exited");
  assert.equal(started.isRunning(), false);
});

test("process runner terminates a spawned child tree before rejecting", async () => {
  const controller = new AbortController();
  let descendantPid;
  const pending = runProcess({
    command: process.execPath,
    args: [
      "-e",
      `const { spawn } = require("node:child_process"); const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 10000)"], { stdio: "ignore" }); console.log(child.pid); setTimeout(() => {}, 10000);`,
    ],
    signal: controller.signal,
    killTree: true,
    gracefulKillMs: 50,
    forceKillMs: 500,
    onStdout(chunk) {
      descendantPid ||= Number(String(chunk).trim());
    },
  });
  for (let attempt = 0; attempt < 100 && !descendantPid; attempt += 1)
    await new Promise((resolve) => setTimeout(resolve, 5));
  assert.ok(descendantPid);
  controller.abort(new Error("test tree abort"));
  await assert.rejects(
    pending,
    process.platform === "win32"
      ? /test tree abort|PROCESS_CLEANUP_TIMEOUT/
      : /test tree abort/,
  );
  if (process.platform !== "win32") {
    await new Promise((resolve) => setTimeout(resolve, 25));
    assert.throws(
      () => process.kill(descendantPid, 0),
      (error) => error.code === "ESRCH",
    );
  }
});

test(
  "process runner confirms a SIGTERM-resistant descendant exits",
  { skip: process.platform === "win32" },
  async () => {
    const controller = new AbortController();
    let descendantPid;
    const pending = runProcess({
      command: process.execPath,
      args: [
        "-e",
        `const { spawn } = require("node:child_process"); const child = spawn(process.execPath, ["-e", "process.on('SIGTERM', () => {}); setInterval(() => {}, 10000)"], { stdio: "ignore" }); console.log(child.pid); process.on("SIGTERM", () => process.exit(0)); setInterval(() => {}, 10000);`,
      ],
      signal: controller.signal,
      killTree: true,
      gracefulKillMs: 25,
      forceKillMs: 500,
      onStdout(chunk) {
        descendantPid ||= Number(String(chunk).trim());
      },
    });
    for (let attempt = 0; attempt < 100 && !descendantPid; attempt += 1)
      await new Promise((resolve) => setTimeout(resolve, 5));
    assert.ok(descendantPid);
    controller.abort(new Error("tree cleanup"));
    await assert.rejects(pending, /tree cleanup/);
    assert.throws(
      () => process.kill(descendantPid, 0),
      (error) => error.code === "ESRCH",
    );
  },
);

test("abortPromise rejects when the signal was already aborted", async () => {
  const controller = new AbortController();
  controller.abort({ kind: "signal", signal: "SIGTERM" });
  await assert.rejects(
    abortPromise(controller.signal),
    (error) =>
      error instanceof BenchPilotError &&
      error.kind === "OPERATION_ABORTED" &&
      error.details.signal === "SIGTERM",
  );
});

test("approval claims are exclusive", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "benchpilot-approval-"));
  try {
    const manager = new ApprovalManager(
      new PathService({ TEMP: path.join(root, "runtime") }, "win32"),
      root,
    );
    const binding = { command: "device.burn", device: "demo" };
    const request = await manager.request(binding);
    await manager.change(request.id, "approved");
    const [first, second] = await Promise.all([
      manager.claim(binding),
      manager.claim(binding),
    ]);
    assert.equal(Boolean(first) !== Boolean(second), true);
    await manager.releaseClaim(first || second);
    await assert.rejects(
      manager.get("../../escape"),
      (error) =>
        error instanceof BenchPilotError &&
        error.kind === "INVALID_APPROVAL_ID",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("approval lists are ordered by creation time", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "benchpilot-approval-order-"),
  );
  try {
    const paths = new PathService(
      { TEMP: path.join(root, "runtime") },
      "win32",
    );
    const manager = new ApprovalManager(paths, root);
    const first = await manager.request({ command: "device.first" });
    const second = await manager.request({ command: "device.second" });
    await atomicJson(path.join(paths.approvalsRoot(root), `${first.id}.json`), {
      ...first,
      createdAt: "2026-01-01T00:00:02.000Z",
    });
    await atomicJson(
      path.join(paths.approvalsRoot(root), `${second.id}.json`),
      { ...second, createdAt: "2026-01-01T00:00:01.000Z" },
    );
    assert.deepEqual(
      (await manager.list()).map((approval) => approval.id),
      [first.id, second.id],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("lock lists are ordered by acquisition time, newest first", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "benchpilot-lock-order-"));
  try {
    const paths = new PathService(
      { TEMP: path.join(root, "runtime") },
      "win32",
    );
    const locks = new LockManager(paths);
    const first = await locks.acquire("lock-first", "test");
    const second = await locks.acquire("lock-second", "test");
    await atomicJson(
      path.join(paths.runtimeRoot(), first.lockId, "owner.json"),
      {
        ...first,
        acquiredAt: "2026-01-01T00:00:01.000Z",
      },
    );
    await atomicJson(
      path.join(paths.runtimeRoot(), second.lockId, "owner.json"),
      {
        ...second,
        acquiredAt: "2026-01-01T00:00:02.000Z",
      },
    );
    assert.deepEqual(
      (await locks.list()).map((lock) => lock.lockId),
      [second.lockId, first.lockId],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("stale file guards recover without allowing an old owner to delete a replacement", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "benchpilot-file-guard-"));
  try {
    const paths = new PathService(
      { TEMP: path.join(root, "runtime") },
      "win32",
    );
    const file = path.join(paths.lockGuardsRoot(), "resource.lock");
    await mkdir(paths.lockGuardsRoot(), { recursive: true });
    await atomicJson(file, {
      schema: "benchpilot.guard",
      version: 1,
      token: "crashed-owner",
      pid: 1,
      hostname: "another-host",
      createdAt: new Date(0).toISOString(),
      expiresAt: new Date(0).toISOString(),
      resourceType: "lock-update",
      resourceId: "resource",
    });
    const guard = await acquireFileGuard(file, {
      resourceType: "lock-update",
      resourceId: "resource",
    });
    const replacement = { ...guard.record, token: "replacement" };
    await atomicJson(file, replacement);
    await guard.release();
    assert.equal((await readJson(file)).token, "replacement");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("stale recovery guards are reclaimed while active recovery guards time out", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "benchpilot-recovery-guard-"),
  );
  try {
    const file = path.join(root, "guard.lock");
    const stale = {
      schema: "benchpilot.guard",
      version: 1,
      token: "stale",
      pid: 1,
      hostname: "another-host",
      createdAt: new Date(0).toISOString(),
      expiresAt: new Date(0).toISOString(),
      resourceType: "lock-update",
      resourceId: "resource",
    };
    await atomicJson(file, stale);
    await atomicJson(`${file}.recovery`, { ...stale, token: "stale-recovery" });
    const recovered = await acquireFileGuard(file, {
      resourceType: "lock-update",
      resourceId: "resource",
      timeoutMs: 50,
    });
    await recovered.release();
    await atomicJson(file, stale);
    await atomicJson(`${file}.recovery`, {
      ...stale,
      token: "active-recovery",
      hostname: os.hostname(),
      pid: process.pid,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    await assert.rejects(
      acquireFileGuard(file, {
        resourceType: "lock-update",
        resourceId: "resource",
        timeoutMs: 25,
      }),
      (error) =>
        error instanceof BenchPilotError && error.kind === "FILE_GUARD_BUSY",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("an old recovery guard release cannot delete its replacement", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "benchpilot-recovery-replacement-"),
  );
  try {
    const file = path.join(root, "guard.lock");
    const recovery = await acquireFileGuard(`${file}.recovery`, {
      resourceType: "lock-update",
      resourceId: "resource",
    });
    await atomicJson(`${file}.recovery`, {
      ...recovery.record,
      token: "replacement-recovery",
    });
    await recovery.release();
    assert.equal(
      (await readJson(`${file}.recovery`)).token,
      "replacement-recovery",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("approval claim is exclusive across processes", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "benchpilot-approval-process-"),
  );
  try {
    const manager = new ApprovalManager(
      new PathService({ TEMP: path.join(root, "runtime") }, "win32"),
      root,
    );
    const binding = { command: "device.burn", device: "demo" };
    const request = await manager.request(binding);
    await manager.change(request.id, "approved");
    const claimer = path.resolve("test/fixtures/approval-claimer.mjs");
    const [first, second] = await Promise.all([
      exec(process.execPath, [claimer, root, JSON.stringify(binding)]),
      exec(process.execPath, [claimer, root, JSON.stringify(binding)]),
    ]);
    assert.deepEqual([first.stdout.trim(), second.stdout.trim()].sort(), [
      "claimed",
      "unavailable",
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("expired approval claim is recovered before a new claim", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "benchpilot-approval-stale-"),
  );
  try {
    const paths = new PathService(
      { TEMP: path.join(root, "runtime") },
      "win32",
    );
    const manager = new ApprovalManager(paths, root);
    const binding = { command: "device.burn", device: "demo" };
    const request = await manager.request(binding);
    await manager.change(request.id, "approved");
    const first = await manager.claim(binding);
    await atomicJson(
      path.join(paths.approvalsRoot(root), `${request.id}.json`),
      {
        ...first,
        claimedBy: "unreachable-host:999999",
        claimExpiresAt: new Date(0).toISOString(),
      },
    );
    const recovered = await manager.claim(binding);
    assert.ok(recovered);
    assert.notEqual(recovered.claimToken, first.claimToken);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("an expired approval claim remains active while its local PID is alive", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "benchpilot-approval-active-pid-"),
  );
  try {
    const manager = new ApprovalManager(
      new PathService({ TEMP: path.join(root, "runtime") }, "win32"),
      root,
    );
    const binding = { command: "device.burn", device: "demo" };
    const request = await manager.request(binding);
    await manager.change(request.id, "approved");
    const claim = await manager.claim(binding);
    await atomicJson(
      path.join(
        root,
        ".benchpilot",
        "state",
        "approvals",
        `${request.id}.json`,
      ),
      { ...claim, claimExpiresAt: new Date(0).toISOString() },
    );
    const active = await manager.get(request.id);
    assert.equal(manager.approvalLiveness(active), "active");
    assert.equal(await manager.claim(binding), undefined);
    await manager.releaseClaim(active);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("approval lease renews an active claim", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "benchpilot-approval-lease-"),
  );
  try {
    const manager = new ApprovalManager(
      new PathService({ TEMP: path.join(root, "runtime") }, "win32"),
      root,
    );
    const binding = { command: "device.burn", device: "demo" };
    const request = await manager.request(binding);
    await manager.change(request.id, "approved");
    const claim = await manager.claim(binding);
    assert.ok(claim);
    const lease = manager.startClaimLease(claim, 5, 30);
    let renewed = claim;
    const deadline = Date.now() + 250;
    do {
      await new Promise((resolve) => setTimeout(resolve, 10));
      renewed = await manager.get(request.id);
    } while (
      Date.parse(renewed.claimHeartbeatAt) <=
        Date.parse(claim.claimHeartbeatAt) &&
      Date.now() < deadline
    );
    assert.ok(
      Date.parse(renewed.claimHeartbeatAt) > Date.parse(claim.claimHeartbeatAt),
    );
    await lease.stop();
    await manager.releaseClaim(claim);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a normal operation recovers and reuses a stale approval claim", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "benchpilot-approval-runner-recovery-"),
  );
  try {
    const paths = new PathService(
      { TEMP: path.join(root, "runtime") },
      "win32",
    );
    const registry = new AdapterRegistry();
    registry.register({
      id: "approval-recovery",
      apiVersion: 1,
      version: "1",
      summary: "approval recovery test",
      configSchema: objectSchema(),
      discover: async () => [],
      doctor: async () => [],
      createDevice: async (instance) => ({
        identity: {
          instance,
          physicalId: "approval-recovery-device",
          adapter: "approval-recovery",
        },
        capabilities: () => [
          {
            id: "burn",
            summary: "burn",
            defaultTimeoutMs: 1_000,
            lockMode: "none",
            createsRun: false,
            safety: { mode: "human-approval", flag: "danger" },
            execute: async () => ({ recovered: true }),
          },
        ],
      }),
    });
    const config = {
      value: {
        approval: { level: "strict" },
        devices: { device: { adapter: "approval-recovery" } },
      },
      origins: new Map(),
      layers: [],
    };
    const binding = {
      command: "device.burn",
      device: {
        instance: "device",
        physicalId: "approval-recovery-device",
        adapter: "approval-recovery",
      },
      input: {},
      project: "outside-project",
      configDigest: (await import("../dist/index.js")).sha(config.value),
    };
    const approvals = new ApprovalManager(paths, root);
    const request = await approvals.request(binding);
    await approvals.change(request.id, "approved");
    const claim = await approvals.claim(binding);
    await atomicJson(
      path.join(paths.approvalsRoot(root), `${request.id}.json`),
      {
        ...claim,
        claimedBy: "dead-host:1",
        claimExpiresAt: new Date(0).toISOString(),
      },
    );
    const runner = new OperationRunner({
      businessLogs: recordingBusinessLogs,
      paths,
      registry,
      project: { root, config: path.join(root, "benchpilot.toml") },
      config,
    });
    const result = await runner.execute(
      "device",
      "burn",
      {},
      {
        safetyConfirmed: true,
      },
    );
    assert.equal(result.ok, true);
    assert.equal((await approvals.list()).length, 1);
    assert.equal((await approvals.get(request.id)).status, "consumed");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("registry supports adapters without CLI routing changes", () => {
  const registry = new AdapterRegistry();
  registry.register({
    id: "test",
    apiVersion: 1,
    version: "1",
    summary: "test",
    configSchema: objectSchema(),
    discover: async () => [],
    doctor: async () => [],
    createDevice: async () => ({
      identity: { instance: "x", physicalId: "x", adapter: "test" },
      capabilities: () => [],
    }),
  });
  assert.equal(registry.get("test").id, "test");
});

test("adapter definitions require a supported API and configuration schema", () => {
  const registry = new AdapterRegistry();
  const methods = {
    discover: async () => [],
    doctor: async () => [],
    createDevice: async () => ({
      identity: { instance: "x", physicalId: "x", adapter: "test" },
      capabilities: () => [],
    }),
  };
  assert.throws(
    () =>
      registry.register({
        id: "missing-api",
        version: "1",
        summary: "x",
        configSchema: objectSchema(),
        ...methods,
      }),
    (error) =>
      error instanceof BenchPilotError &&
      error.kind === "UNSUPPORTED_ADAPTER_API_VERSION",
  );
  assert.throws(
    () =>
      registry.register({
        id: "wrong-api",
        apiVersion: 2,
        version: "1",
        summary: "x",
        configSchema: objectSchema(),
        ...methods,
      }),
    (error) =>
      error instanceof BenchPilotError &&
      error.kind === "UNSUPPORTED_ADAPTER_API_VERSION",
  );
  assert.throws(
    () =>
      registry.register({
        id: "missing-schema",
        apiVersion: 1,
        version: "1",
        summary: "x",
        ...methods,
      }),
    (error) =>
      error instanceof BenchPilotError &&
      error.kind === "INVALID_ADAPTER_DEFINITION",
  );
  registry.register({
    id: "configured",
    apiVersion: 1,
    version: "1",
    summary: "configured",
    configSchema: objectSchema({ enabled: booleanSchema() }),
    ...methods,
  });
  assert.throws(
    () =>
      registry.configFor(registry.get("configured"), {
        adapters: { configured: { enabled: "yes" } },
      }),
    (error) =>
      error instanceof BenchPilotError &&
      error.kind === "INVALID_ADAPTER_CONFIG",
  );
  registry.register({
    id: "device-configured",
    apiVersion: 1,
    version: "1",
    summary: "device configured",
    configSchema: objectSchema(),
    deviceConfigSchema: objectSchema({ port: stringSchema() }),
    ...methods,
  });
  return assert.rejects(
    registry.createDevice(
      registry.get("device-configured"),
      "device",
      { port: 42 },
      { adapters: { "device-configured": {} } },
      new PathService({}, process.platform, os.tmpdir()),
    ),
    (error) =>
      error instanceof BenchPilotError &&
      error.kind === "INVALID_DEVICE_CONFIG",
  );
});

test("registry injects validated adapter config into createDevice", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "benchpilot-adapter-config-"),
  );
  try {
    const paths = new PathService(
      { TEMP: path.join(root, "runtime") },
      "win32",
    );
    const registry = new AdapterRegistry();
    let received;
    registry.register({
      id: "injected-config",
      apiVersion: 1,
      version: "1",
      summary: "injected config test",
      configSchema: objectSchema({ toolchain: stringSchema() }),
      deviceConfigSchema: objectSchema({ target: stringSchema() }),
      discover: async () => [],
      doctor: async () => [],
      createDevice: async (_instance, deviceConfig, services) => {
        received = { deviceConfig, services };
        return {
          identity: {
            instance: "device",
            physicalId: "device",
            adapter: "injected-config",
          },
          capabilities: () => [],
        };
      },
    });
    await registry.createDevice(
      registry.get("injected-config"),
      "device",
      { target: "test" },
      { adapters: { "injected-config": { toolchain: "configured" } } },
      paths,
    );
    assert.deepEqual(received.deviceConfig, { target: "test" });
    assert.equal(received.services.adapterConfig.toolchain, "configured");
    assert.equal(received.services.paths, paths);
    await assert.rejects(
      registry.createDevice(
        registry.get("injected-config"),
        "device",
        { target: "test" },
        { adapters: { "injected-config": { toolchain: false } } },
        paths,
      ),
      (cause) =>
        cause instanceof BenchPilotError &&
        cause.kind === "INVALID_ADAPTER_CONFIG",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("output schema failures are classified as INVALID_CAPABILITY_OUTPUT", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "benchpilot-output-schema-"),
  );
  try {
    const paths = new PathService(
      { TEMP: path.join(root, "runtime") },
      "win32",
    );
    const registry = new AdapterRegistry();
    registry.register({
      id: "output-schema",
      apiVersion: 1,
      version: "1",
      summary: "output schema test",
      configSchema: objectSchema(),
      discover: async () => [],
      doctor: async () => [],
      createDevice: async (instance) => ({
        identity: { instance, physicalId: "output", adapter: "output-schema" },
        capabilities: () => [
          {
            id: "bad-output",
            summary: "bad output",
            defaultTimeoutMs: 1_000,
            lockMode: "none",
            createsRun: false,
            safety: { mode: "normal" },
            outputSchema: objectSchema({ value: stringSchema() }),
            execute: async () => ({ value: 1 }),
          },
          {
            id: "unregistered-artifact",
            summary: "unregistered artifact",
            defaultTimeoutMs: 1_000,
            lockMode: "none",
            createsRun: true,
            safety: { mode: "normal" },
            execute: async () => ({
              artifact: { name: "untrusted.bin", path: "untrusted.bin" },
            }),
          },
        ],
      }),
    });
    const runner = new OperationRunner({
      businessLogs: recordingBusinessLogs,
      paths,
      registry,
      project: { root, config: path.join(root, "benchpilot.toml") },
      config: {
        value: { devices: { device: { adapter: "output-schema" } } },
        origins: new Map(),
        layers: [],
      },
    });
    const error = await runner
      .execute("device", "bad-output", {})
      .catch((cause) => cause);
    assert.equal(error.kind, "INVALID_CAPABILITY_OUTPUT");
    const unregistered = await runner.execute(
      "device",
      "unregistered-artifact",
      {},
    );
    assert.deepEqual(unregistered.artifacts, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("artifact registry verifies location, file type, size, and hash", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "benchpilot-artifact-"));
  try {
    const artifacts = path.join(root, "artifacts");
    await mkdir(artifacts);
    const file = path.join(artifacts, "firmware.bin");
    await writeFile(file, "firmware");
    const registry = new ArtifactRegistry({
      id: "run",
      dir: root,
      started: Date.now(),
      command: "build",
    });
    const artifact = await registry.register({
      name: "firmware.bin",
      kind: "firmware",
      path: file,
    });
    assert.equal(artifact.path, path.join("artifacts", "firmware.bin"));
    assert.equal(artifact.size, 8);
    assert.match(artifact.sha256, /^[a-f0-9]{64}$/);
    await assert.rejects(
      registry.register({
        name: "missing",
        kind: "firmware",
        path: path.join(artifacts, "missing.bin"),
      }),
      (error) =>
        error instanceof BenchPilotError && error.kind === "INVALID_ARTIFACT",
    );
    await assert.rejects(
      registry.register({
        name: "directory",
        kind: "firmware",
        path: artifacts,
      }),
      (error) =>
        error instanceof BenchPilotError && error.kind === "INVALID_ARTIFACT",
    );
    await assert.rejects(
      registry.register({ name: "outside", kind: "firmware", path: root }),
      (error) =>
        error instanceof BenchPilotError && error.kind === "INVALID_ARTIFACT",
    );
    const outside = path.join(root, "outside.bin");
    await writeFile(outside, "outside");
    const link = path.join(artifacts, "escape.bin");
    try {
      await symlink(outside, link, "file");
      await assert.rejects(
        registry.register({ name: "escape", kind: "firmware", path: link }),
        (error) =>
          error instanceof BenchPilotError && error.kind === "INVALID_ARTIFACT",
      );
    } catch (error) {
      if (error.code !== "EPERM") throw error;
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("artifact registry accepts a canonicalized run path without escaping it", async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), "benchpilot-artifact-"));
  const alias = `${target}-alias`;
  try {
    await mkdir(path.join(target, "artifacts"));
    await symlink(
      target,
      alias,
      process.platform === "win32" ? "junction" : "dir",
    );
    const file = path.join(alias, "artifacts", "firmware.bin");
    await writeFile(file, "firmware");
    const registry = new ArtifactRegistry({
      id: "run",
      dir: alias,
      started: Date.now(),
      command: "build",
    });
    const artifact = await registry.register({
      name: "firmware.bin",
      kind: "firmware",
      path: file,
    });
    assert.equal(artifact.path, path.join("artifacts", "firmware.bin"));
  } finally {
    await rm(alias, { recursive: true, force: true });
    await rm(target, { recursive: true, force: true });
  }
});

test("lock lease stops before release and rejects unsafe IDs", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "benchpilot-lock-"));
  try {
    const paths = new PathService(
      { TEMP: path.join(root, "runtime") },
      "win32",
    );
    const locks = new LockManager(paths);
    const lock = await locks.acquire("demo-device-safe", "test");
    assert.equal(lock.version, 2);
    assert.equal(path.basename(locks.file(lock.lockId)), "owner.json");
    const lease = locks.startHeartbeat(lock, 1, 100);
    await lease.stop();
    await locks.release(lock);
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal((await locks.list()).length, 0);
    assert.throws(() => locks.file("../escape"), /Invalid lock ID/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("lock acquire recovers empty directories but rejects corrupt contents", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "benchpilot-lock-corrupt-"),
  );
  try {
    const paths = new PathService(
      { TEMP: path.join(root, "runtime") },
      "win32",
    );
    const locks = new LockManager(paths);
    await mkdir(locks.directory("empty-lock"), { recursive: true });
    const recovered = await locks.acquire("empty-lock", "test");
    assert.equal(recovered.lockId, "empty-lock");
    await locks.release(recovered);
    await mkdir(locks.directory("unknown-lock"), { recursive: true });
    await writeFile(path.join(locks.directory("unknown-lock"), "unknown"), "x");
    await assert.rejects(
      locks.acquire("unknown-lock", "test"),
      (error) =>
        error instanceof BenchPilotError && error.kind === "LOCK_CORRUPT",
    );
    await mkdir(locks.directory("invalid-owner"), { recursive: true });
    await writeFile(locks.file("invalid-owner"), "not-json");
    await assert.rejects(
      locks.acquire("invalid-owner", "test"),
      (error) =>
        error instanceof BenchPilotError && error.kind === "LOCK_CORRUPT",
    );
    await mkdir(locks.directory("incomplete-owner"), { recursive: true });
    await writeFile(locks.file("incomplete-owner"), "{}");
    await assert.rejects(
      locks.acquire("incomplete-owner", "test"),
      (error) =>
        error instanceof BenchPilotError && error.kind === "LOCK_CORRUPT",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test(
  "lock heartbeat maintains ownership past the original thirty-second lease",
  { timeout: 45_000 },
  async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "benchpilot-lock-long-"));
    try {
      const paths = new PathService(
        { TEMP: path.join(root, "runtime") },
        "win32",
      );
      const locks = new LockManager(paths);
      const lock = await locks.acquire("demo-device-long-heartbeat", "test");
      const originalExpiry = Date.parse(lock.expiresAt);
      const lease = locks.startHeartbeat(lock, 1_000, 30_000);
      await new Promise((resolve) => setTimeout(resolve, 35_000));
      await lease.stop();
      const [current] = await locks.list();
      assert.ok(current);
      assert.ok(Date.parse(current.heartbeatAt) > originalExpiry);
      await locks.release(lock);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);

test("lock ownership loss aborts the capability and preserves the replacement", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "benchpilot-lock-abort-"));
  let aborted = false;
  let cleaned = false;
  try {
    const paths = new PathService(
      { TEMP: path.join(root, "runtime") },
      "win32",
    );
    const registry = new AdapterRegistry();
    registry.register({
      id: "lock-loss",
      apiVersion: 1,
      version: "1",
      summary: "lock loss test",
      configSchema: objectSchema(),
      discover: async () => [],
      doctor: async () => [],
      createDevice: async (instance) => ({
        identity: {
          instance,
          physicalId: "lock-loss-device",
          adapter: "lock-loss",
        },
        capabilities: () => [
          {
            id: "wait",
            summary: "wait",
            defaultTimeoutMs: 2_000,
            lockMode: "exclusive",
            createsRun: true,
            safety: { mode: "normal" },
            execute: async (context) => {
              context.registerCleanup("observe-cleanup", () => {
                cleaned = true;
              });
              await new Promise((resolve) => {
                context.signal.addEventListener(
                  "abort",
                  () => {
                    aborted = true;
                    resolve();
                  },
                  { once: true },
                );
              });
              return {};
            },
          },
        ],
      }),
    });
    const runner = new OperationRunner({
      businessLogs: recordingBusinessLogs,
      paths,
      registry,
      project: { root, config: path.join(root, "benchpilot.toml") },
      lockHeartbeatIntervalMs: 1_000,
      lockLeaseMs: 100,
      config: {
        value: { devices: { device: { adapter: "lock-loss" } } },
        origins: new Map(),
        layers: [],
      },
    });
    const pending = runner.execute("device", "wait", {});
    const locks = new LockManager(paths);
    let held;
    for (let attempt = 0; attempt < 100 && !held; attempt += 1) {
      [held] = await locks.list();
      if (!held) await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.ok(held);
    await atomicJson(locks.file(held.lockId), {
      ...held,
      ownerToken: "replacement-owner",
    });
    const error = await pending.catch((cause) => cause);
    assert.equal(error.kind, "LOCK_OWNERSHIP_LOST");
    assert.equal(aborted, true);
    assert.equal(cleaned, true);
    assert.equal((await locks.list())[0].ownerToken, "replacement-owner");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("heartbeat reports lock ownership loss without deleting a replacement", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "benchpilot-lock-lost-"));
  try {
    const paths = new PathService(
      { TEMP: path.join(root, "runtime") },
      "win32",
    );
    const locks = new LockManager(paths);
    const lock = await locks.acquire("demo-device-lost", "test");
    await atomicJson(locks.file(lock.lockId), {
      ...lock,
      ownerToken: "replacement",
    });
    await assert.rejects(
      locks.heartbeat(lock),
      (error) =>
        error instanceof BenchPilotError &&
        error.kind === "LOCK_OWNERSHIP_LOST",
    );
    await assert.rejects(
      locks.release(lock),
      (error) =>
        error instanceof BenchPilotError &&
        error.kind === "LOCK_OWNERSHIP_LOST",
    );
    assert.equal((await locks.list())[0].ownerToken, "replacement");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("heartbeat rechecks ownership after a guarded asynchronous step", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "benchpilot-lock-cas-"));
  let resume;
  try {
    const paths = new PathService(
      { TEMP: path.join(root, "runtime") },
      "win32",
    );
    const locks = new LockManager(paths, {
      heartbeatRead: () =>
        new Promise((resolve) => {
          resume = resolve;
        }),
    });
    const lock = await locks.acquire("demo-device-cas", "test");
    const pending = locks.heartbeat(lock);
    for (let attempt = 0; attempt < 50 && !resume; attempt += 1)
      await new Promise((resolve) => setTimeout(resolve, 2));
    await atomicJson(locks.file(lock.lockId), {
      ...lock,
      ownerToken: "replacement",
    });
    resume();
    await assert.rejects(
      pending,
      (error) =>
        error instanceof BenchPilotError &&
        error.kind === "LOCK_OWNERSHIP_LOST",
    );
    assert.equal((await locks.list())[0].ownerToken, "replacement");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("release rechecks ownership after a guarded asynchronous step", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "benchpilot-release-cas-"));
  let resume;
  try {
    const paths = new PathService(
      { TEMP: path.join(root, "runtime") },
      "win32",
    );
    const locks = new LockManager(paths, {
      releaseRead: () =>
        new Promise((resolve) => {
          resume = resolve;
        }),
    });
    const lock = await locks.acquire("demo-device-release", "test");
    const pending = locks.release(lock);
    for (let attempt = 0; attempt < 50 && !resume; attempt += 1)
      await new Promise((resolve) => setTimeout(resolve, 2));
    await atomicJson(locks.file(lock.lockId), {
      ...lock,
      ownerToken: "replacement",
    });
    resume();
    await assert.rejects(
      pending,
      (error) =>
        error instanceof BenchPilotError &&
        error.kind === "LOCK_OWNERSHIP_LOST",
    );
    assert.equal((await locks.list())[0].ownerToken, "replacement");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("clear rechecks ownership after a guarded asynchronous step", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "benchpilot-clear-cas-"));
  let resume;
  try {
    const paths = new PathService(
      { TEMP: path.join(root, "runtime") },
      "win32",
    );
    const locks = new LockManager(paths, {
      clearRead: () =>
        new Promise((resolve) => {
          resume = resolve;
        }),
    });
    const lock = await locks.acquire("demo-device-clear", "test");
    const pending = locks.clear(lock.lockId, true);
    for (let attempt = 0; attempt < 50 && !resume; attempt += 1)
      await new Promise((resolve) => setTimeout(resolve, 2));
    await atomicJson(locks.file(lock.lockId), {
      ...lock,
      ownerToken: "replacement",
    });
    resume();
    await assert.rejects(
      pending,
      (error) =>
        error instanceof BenchPilotError &&
        error.kind === "LOCK_OWNERSHIP_LOST",
    );
    assert.equal((await locks.list())[0].ownerToken, "replacement");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("stale cleanup cannot remove a manual quarantine recovery record", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "benchpilot-lock-recovery-"),
  );
  try {
    const paths = new PathService(
      { TEMP: path.join(root, "runtime") },
      "win32",
    );
    const locks = new LockManager(paths);
    const lock = await locks.acquire("recovery-device", "test");
    await locks.recordQuarantineFailure(lock, {
      kind: "QUARANTINE_FAILED",
      message: "manual recovery required",
      cleanupErrors: [],
      runId: "run-test",
    });
    await atomicJson(locks.file(lock.lockId), {
      ...lock,
      pid: 99999999,
      heartbeatAt: new Date(0).toISOString(),
      expiresAt: new Date(0).toISOString(),
    });

    assert.deepEqual(await locks.clearStale(), [lock.lockId]);
    assert.equal((await locks.listManualRecovery()).length, 1);
    await assert.rejects(
      locks.clearManualRecovery(lock.lockId),
      (error) =>
        error instanceof BenchPilotError &&
        error.kind === "DANGEROUS_CONFIRMATION_REQUIRED",
    );
    await locks.clearManualRecovery(lock.lockId, true);
    assert.deepEqual(await locks.listManualRecovery(), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("separate processes cannot acquire the same physical lock", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "benchpilot-lock-process-"),
  );
  const id = "demo-device-process";
  const holder = spawn(
    process.execPath,
    [path.resolve("test/fixtures/lock-holder.mjs"), root, id],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  try {
    await new Promise((resolve, reject) => {
      holder.stdout.once("data", resolve);
      holder.once("error", reject);
    });
    const moduleUrl = new URL("../dist/index.js", import.meta.url).href;
    const script = `import { LockManager, PathService } from ${JSON.stringify(moduleUrl)}; const manager = new LockManager(new PathService({ TEMP: process.argv[1] }, "win32")); await manager.acquire(process.argv[2], "contender");`;
    const contender = await exec(process.execPath, [
      "--input-type=module",
      "-e",
      script,
      root,
      id,
    ]).catch((error) => error);
    assert.notEqual(contender.code, 0);
    assert.match(contender.stderr, /DEVICE_BUSY/);
  } finally {
    holder.kill();
    await new Promise((resolve) => holder.once("exit", resolve));
    await rm(root, { recursive: true, force: true });
  }
});

test("critical cleanup failure quarantines its lock and finalizes a failed run", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "benchpilot-cleanup-"));
  const events = [];
  try {
    const paths = new PathService(
      { TEMP: path.join(root, "runtime") },
      "win32",
    );
    const registry = new AdapterRegistry();
    registry.register({
      id: "test",
      apiVersion: 1,
      version: "1",
      summary: "cleanup test",
      configSchema: objectSchema(),
      discover: async () => [],
      doctor: async () => [],
      createDevice: async (instance) => ({
        identity: { instance, physicalId: "cleanup-device", adapter: "test" },
        capabilities: () => [
          {
            id: "cleanup",
            summary: "cleanup",
            defaultTimeoutMs: 1000,
            lockMode: "exclusive",
            createsRun: true,
            safety: { mode: "normal" },
            execute: async (context) => {
              context.registerCleanup("failing-cleanup", async () => {
                throw new Error("cleanup failed");
              });
              return { ok: true };
            },
          },
        ],
      }),
    });
    const runner = new OperationRunner({
      businessLogs: recordingBusinessLogs,
      paths,
      registry,
      project: { root, config: path.join(root, "benchpilot.toml") },
      reporter: {
        emit(type, data) {
          events.push({ type, data });
        },
      },
      config: {
        value: { devices: { device: { adapter: "test" } } },
        origins: new Map(),
        layers: [],
      },
    });
    const error = await runner
      .execute("device", "cleanup", {})
      .catch((cause) => cause);
    assert.equal(error.kind, "CLEANUP_FAILED");
    const [lock] = await new LockManager(paths).list();
    assert.equal(lock.state, "quarantined");
    assert.equal(lock.quarantineReason.kind, "CLEANUP_FAILED");
    const locks = new LockManager(paths);
    await assert.rejects(
      locks.acquire(lock.lockId, "contender"),
      (cause) =>
        cause instanceof BenchPilotError && cause.kind === "DEVICE_QUARANTINED",
    );
    await assert.rejects(
      locks.clear(lock.lockId),
      (cause) =>
        cause instanceof BenchPilotError &&
        cause.kind === "DANGEROUS_CONFIRMATION_REQUIRED",
    );
    await locks.clear(lock.lockId, { dangerousQuarantined: true });
    assert.equal((await locks.list()).length, 0);
    assert.equal(error.result.ok, false);
    assert.deepEqual(error.result.cleanupErrors, [
      {
        name: "failing-cleanup",
        critical: true,
        holdsPhysicalResource: true,
        timedOut: false,
        message: "cleanup failed",
      },
    ]);
    assert.deepEqual(
      events.map((event) => event.type).at(-1),
      "operation.failed",
    );
    assert.equal(
      events.filter((event) => /operation\.(completed|failed)/.test(event.type))
        .length,
      1,
    );
    const runs = await new RunManager(paths, root).list();
    assert.equal(runs[0].manifest.status, "failed");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cleanup timeout quarantines a lock when a capability ignores AbortSignal", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "benchpilot-timeout-"));
  let cleaned = false;
  try {
    const paths = new PathService(
      { TEMP: path.join(root, "runtime") },
      "win32",
    );
    const registry = new AdapterRegistry();
    registry.register({
      id: "timeout",
      apiVersion: 1,
      version: "1",
      summary: "timeout test",
      configSchema: objectSchema(),
      discover: async () => [],
      doctor: async () => [],
      createDevice: async (instance) => ({
        identity: {
          instance,
          physicalId: "timeout-device",
          adapter: "timeout",
        },
        capabilities: () => [
          {
            id: "hang",
            summary: "hang",
            defaultTimeoutMs: 1000,
            lockMode: "exclusive",
            createsRun: true,
            safety: { mode: "normal" },
            execute: async (context) => {
              context.registerCleanup(
                "cleanup",
                () => {
                  cleaned = true;
                  return new Promise(() => {});
                },
                { timeoutMs: 10 },
              );
              return new Promise(() => {});
            },
          },
        ],
      }),
    });
    const runner = new OperationRunner({
      businessLogs: recordingBusinessLogs,
      paths,
      registry,
      project: { root, config: path.join(root, "benchpilot.toml") },
      defaults: { timeout: "10ms" },
      config: {
        value: { devices: { device: { adapter: "timeout" } } },
        origins: new Map(),
        layers: [],
      },
    });
    const error = await runner
      .execute("device", "hang", {})
      .catch((cause) => cause);
    assert.equal(error.kind, "OPERATION_TIMEOUT");
    assert.equal(cleaned, true);
    const [lock] = await new LockManager(paths).list();
    assert.equal(lock.state, "quarantined");
    assert.equal(lock.quarantineReason.cleanupErrors[0].timedOut, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function runCleanupFailureScenario(root, options) {
  const paths = new PathService({ TEMP: path.join(root, "runtime") }, "win32");
  const registry = new AdapterRegistry();
  registry.register({
    id: "cleanup-semantics",
    apiVersion: 1,
    version: "1",
    summary: "cleanup semantics",
    configSchema: objectSchema(),
    discover: async () => [],
    doctor: async () => [],
    createDevice: async (instance) => ({
      identity: {
        instance,
        physicalId: "cleanup-semantics",
        adapter: "cleanup-semantics",
      },
      capabilities: () => [
        {
          id: "run",
          summary: "run",
          defaultTimeoutMs: 1_000,
          lockMode: "exclusive",
          createsRun: false,
          safety: { mode: "normal" },
          execute: async (context) => {
            context.registerCleanup(
              "cleanup",
              () => {
                throw new Error("cleanup failed");
              },
              options,
            );
            return { ok: true };
          },
        },
      ],
    }),
  });
  const runner = new OperationRunner({
    businessLogs: recordingBusinessLogs,
    paths,
    registry,
    project: { root, config: path.join(root, "benchpilot.toml") },
    config: {
      value: { devices: { device: { adapter: "cleanup-semantics" } } },
      origins: new Map(),
      layers: [],
    },
  });
  const outcome = await runner
    .execute("device", "run", {})
    .catch((error) => error);
  return { outcome, locks: await new LockManager(paths).list() };
}

test("physical cleanup failures quarantine and fail even when declared non-critical", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "benchpilot-physical-cleanup-"),
  );
  try {
    const { outcome, locks } = await runCleanupFailureScenario(root, {
      critical: false,
      holdsPhysicalResource: true,
    });
    assert.equal(outcome.kind, "CLEANUP_FAILED");
    assert.equal(locks[0].state, "quarantined");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("non-physical cleanup failures preserve warning and release the lock", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "benchpilot-nonphysical-cleanup-"),
  );
  try {
    const warning = await runCleanupFailureScenario(root, {
      critical: false,
      holdsPhysicalResource: false,
    });
    assert.equal(warning.outcome.ok, true);
    assert.equal(warning.outcome.cleanupErrors[0].critical, false);
    assert.equal(warning.locks.length, 0);
    const critical = await runCleanupFailureScenario(root, {
      critical: true,
      holdsPhysicalResource: false,
    });
    assert.equal(critical.outcome.kind, "CLEANUP_FAILED");
    assert.equal(critical.locks.length, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function runDangerousFailure(root, markEffect) {
  const paths = new PathService({ TEMP: path.join(root, "runtime") }, "win32");
  const registry = new AdapterRegistry();
  registry.register({
    id: "danger",
    apiVersion: 1,
    version: "1",
    summary: "danger test",
    configSchema: objectSchema(),
    discover: async () => [],
    doctor: async () => [],
    createDevice: async (instance) => ({
      identity: { instance, physicalId: "danger-device", adapter: "danger" },
      capabilities: () => [
        {
          id: "effect",
          summary: "effect",
          defaultTimeoutMs: 1000,
          lockMode: "exclusive",
          createsRun: true,
          safety: { mode: "human-approval", flag: "danger" },
          execute: async (context) => {
            if (markEffect) context.markDangerousEffectStarted();
            throw new BenchPilotError("OPERATION_FAILED", 5, "planned failure");
          },
        },
      ],
    }),
  });
  const config = {
    value: {
      approval: { level: "strict" },
      devices: { device: { adapter: "danger" } },
    },
    origins: new Map(),
    layers: [],
  };
  const binding = {
    command: "device.effect",
    device: {
      instance: "device",
      physicalId: "danger-device",
      adapter: "danger",
    },
    input: {},
    project: "outside-project",
    configDigest: "placeholder",
  };
  // OperationRunner derives the actual digest from the resolved config.
  binding.configDigest = (await import("../dist/index.js")).sha(config.value);
  const approvals = new ApprovalManager(paths, root);
  const approval = await approvals.request(binding);
  await approvals.change(approval.id, "approved");
  const runner = new OperationRunner({
    businessLogs: recordingBusinessLogs,
    paths,
    registry,
    project: { root, config: path.join(root, "benchpilot.toml") },
    config,
  });
  await runner
    .execute("device", "effect", {}, { safetyConfirmed: true })
    .catch(() => {});
  return approvals.get(approval.id);
}

test("ordinary dangerous-operation failure releases the approval claim", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "benchpilot-approval-release-"),
  );
  try {
    assert.equal((await runDangerousFailure(root, false)).status, "approved");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("post-effect dangerous-operation failure consumes the approval claim", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "benchpilot-approval-consume-"),
  );
  try {
    assert.equal((await runDangerousFailure(root, true)).status, "consumed");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("successful dangerous operation without a marker consumes approval and warns", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "benchpilot-approval-marker-missing-"),
  );
  const events = [];
  try {
    const paths = new PathService(
      { TEMP: path.join(root, "runtime") },
      "win32",
    );
    const registry = new AdapterRegistry();
    registry.register({
      id: "marker-missing",
      apiVersion: 1,
      version: "1",
      summary: "marker missing test",
      configSchema: objectSchema(),
      discover: async () => [],
      doctor: async () => [],
      createDevice: async (instance) => ({
        identity: {
          instance,
          physicalId: "marker-missing-device",
          adapter: "marker-missing",
        },
        capabilities: () => [
          {
            id: "effect",
            summary: "effect",
            defaultTimeoutMs: 1000,
            lockMode: "exclusive",
            createsRun: true,
            safety: { mode: "human-approval", flag: "danger" },
            execute: async () => ({ ok: true }),
          },
        ],
      }),
    });
    const config = {
      value: {
        approval: { level: "strict" },
        devices: { device: { adapter: "marker-missing" } },
      },
      origins: new Map(),
      layers: [],
    };
    const approval = await new ApprovalManager(paths, root).request({
      command: "device.effect",
      device: {
        instance: "device",
        physicalId: "marker-missing-device",
        adapter: "marker-missing",
      },
      input: {},
      project: "outside-project",
      configDigest: (await import("../dist/index.js")).sha(config.value),
    });
    const approvals = new ApprovalManager(paths, root);
    await approvals.change(approval.id, "approved");
    const runner = new OperationRunner({
      businessLogs: recordingBusinessLogs,
      paths,
      registry,
      project: { root, config: path.join(root, "benchpilot.toml") },
      config,
      reporter: {
        emit(type, data) {
          events.push({ type, data });
        },
      },
    });
    await runner.execute("device", "effect", {}, { safetyConfirmed: true });
    assert.equal((await approvals.get(approval.id)).status, "consumed");
    assert.deepEqual(
      events.find((event) => event.type === "safety.marker-missing"),
      {
        type: "safety.marker-missing",
        data: {
          approvalId: approval.id,
          capability: "effect",
          code: "DANGEROUS_EFFECT_MARKER_MISSING",
        },
      },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
