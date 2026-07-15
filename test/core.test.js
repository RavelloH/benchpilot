import test from "node:test";
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import {
  AdapterRegistry,
  ArtifactRegistry,
  abortPromise,
  ApprovalManager,
  atomicJson,
  booleanSchema,
  durationSchema,
  enumSchema,
  BenchPilotError,
  PathService,
  projectStorageKey,
  RunManager,
  SchemaValidationError,
  lockIdentity,
  isSupportedNodeVersion,
  LockManager,
  objectSchema,
  OperationRunner,
  redactResolvedConfig,
  runProcess,
  setKey,
  stringSchema,
} from "../dist/index.js";

const exec = promisify(execFile);

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
  await assert.rejects(pending, /test abort/);
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
  await assert.rejects(pending, /test tree abort/);
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.throws(
    () => process.kill(descendantPid, 0),
    (error) => error.code === "ESRCH",
  );
});

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
      new PathService({ BENCHPILOT_HOME: root }),
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

test("approval claim is exclusive across processes", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "benchpilot-approval-process-"),
  );
  try {
    const manager = new ApprovalManager(
      new PathService({ BENCHPILOT_HOME: root }),
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
    const paths = new PathService({ BENCHPILOT_HOME: root });
    const manager = new ApprovalManager(paths);
    const binding = { command: "device.burn", device: "demo" };
    const request = await manager.request(binding);
    await manager.change(request.id, "approved");
    const first = await manager.claim(binding);
    await atomicJson(path.join(paths.approvalsRoot(), `${request.id}.json`), {
      ...first,
      claimedBy: "unreachable-host:999999",
      claimExpiresAt: new Date(0).toISOString(),
    });
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
      new PathService({ BENCHPILOT_HOME: root }),
    );
    const binding = { command: "device.burn", device: "demo" };
    const request = await manager.request(binding);
    await manager.change(request.id, "approved");
    const claim = await manager.claim(binding);
    await atomicJson(
      path.join(root, "state", "approvals", `${request.id}.json`),
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
      new PathService({ BENCHPILOT_HOME: root }),
    );
    const binding = { command: "device.burn", device: "demo" };
    const request = await manager.request(binding);
    await manager.change(request.id, "approved");
    const claim = await manager.claim(binding);
    assert.ok(claim);
    const lease = manager.startClaimLease(claim, 5, 30);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const renewed = await manager.get(request.id);
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
    const paths = new PathService({ BENCHPILOT_HOME: root });
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
      value: { devices: { device: { adapter: "approval-recovery" } } },
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
    const approvals = new ApprovalManager(paths);
    const request = await approvals.request(binding);
    await approvals.change(request.id, "approved");
    const claim = await approvals.claim(binding);
    await atomicJson(path.join(paths.approvalsRoot(), `${request.id}.json`), {
      ...claim,
      claimedBy: "dead-host:1",
      claimExpiresAt: new Date(0).toISOString(),
    });
    const runner = new OperationRunner({
      paths,
      registry,
      project: undefined,
      flags: { quiet: true, danger: true },
      config,
    });
    const result = await runner.execute("device", "burn", {});
    assert.equal(result.ok, true);
    assert.equal((await approvals.list()).length, 1);
    assert.equal((await approvals.get(request.id)).status, "approved");
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
    ),
    (error) =>
      error instanceof BenchPilotError &&
      error.kind === "INVALID_DEVICE_CONFIG",
  );
});

test("output schema failures are classified as INVALID_CAPABILITY_OUTPUT", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "benchpilot-output-schema-"),
  );
  try {
    const paths = new PathService({ BENCHPILOT_HOME: root });
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
      paths,
      registry,
      project: undefined,
      flags: { quiet: true },
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

test("lock lease stops before release and rejects unsafe IDs", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "benchpilot-lock-"));
  try {
    const paths = new PathService({ BENCHPILOT_HOME: root });
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

test(
  "lock heartbeat maintains ownership past the original thirty-second lease",
  { timeout: 45_000 },
  async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "benchpilot-lock-long-"));
    try {
      const paths = new PathService({ BENCHPILOT_HOME: root });
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
    const paths = new PathService({ BENCHPILOT_HOME: root });
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
      paths,
      registry,
      project: undefined,
      flags: { quiet: true },
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
    const paths = new PathService({ BENCHPILOT_HOME: root });
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
    const paths = new PathService({ BENCHPILOT_HOME: root });
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
    const paths = new PathService({ BENCHPILOT_HOME: root });
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
    const paths = new PathService({ BENCHPILOT_HOME: root });
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
    const script = `import { LockManager, PathService } from ${JSON.stringify(moduleUrl)}; const manager = new LockManager(new PathService({ BENCHPILOT_HOME: process.argv[1] })); await manager.acquire(process.argv[2], "contender");`;
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

test("critical cleanup failure finalizes a failed run after releasing its lock", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "benchpilot-cleanup-"));
  const events = [];
  try {
    const paths = new PathService({ BENCHPILOT_HOME: root });
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
      paths,
      registry,
      project: undefined,
      flags: { quiet: true },
      eventWriter: {
        emit(type, data) {
          events.push({ type, data });
        },
        completed(result) {
          events.push({ type: "operation.completed", result });
        },
        failed(error) {
          events.push({ type: "operation.failed", error });
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
    assert.equal((await new LockManager(paths).list()).length, 0);
    assert.equal(error.result.ok, false);
    assert.deepEqual(error.result.cleanupErrors, [
      {
        name: "failing-cleanup",
        critical: true,
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
    const runs = await new RunManager(paths, projectStorageKey({})).list();
    assert.equal(runs[0].manifest.status, "failed");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("timeout returns even when a capability ignores AbortSignal and runs cleanup", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "benchpilot-timeout-"));
  let cleaned = false;
  try {
    const paths = new PathService({ BENCHPILOT_HOME: root });
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
              context.registerCleanup("cleanup", () => {
                cleaned = true;
              });
              return new Promise(() => {});
            },
          },
        ],
      }),
    });
    const runner = new OperationRunner({
      paths,
      registry,
      project: undefined,
      flags: { quiet: true, timeout: "10ms" },
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
    assert.equal((await new LockManager(paths).list()).length, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function runDangerousFailure(root, markEffect) {
  const paths = new PathService({ BENCHPILOT_HOME: root });
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
    value: { devices: { device: { adapter: "danger" } } },
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
  const approvals = new ApprovalManager(paths);
  const approval = await approvals.request(binding);
  await approvals.change(approval.id, "approved");
  const runner = new OperationRunner({
    paths,
    registry,
    project: undefined,
    flags: { quiet: true, danger: true },
    config,
  });
  await runner.execute("device", "effect", {}).catch(() => {});
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
