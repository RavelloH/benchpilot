import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  AdapterRegistry,
  ApprovalManager,
  BenchPilotError,
  PathService,
  lockIdentity,
  redactResolvedConfig,
  setKey,
} from "../dist/index.js";

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
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("registry supports adapters without CLI routing changes", () => {
  const registry = new AdapterRegistry();
  registry.register({
    id: "test",
    version: "1",
    summary: "test",
    discover: async () => [],
    doctor: async () => [],
    createDevice: async () => ({
      identity: { instance: "x", physicalId: "x", adapter: "test" },
      capabilities: () => [],
    }),
  });
  assert.equal(registry.get("test").id, "test");
});
