import assert from "node:assert/strict";
import test from "node:test";
import { ApplicationDynamicCommandProvider } from "../dist/application/commands/dynamic-provider.js";
import { BenchPilotError } from "../dist/core.js";

test("Application dynamic providers use only read-only query methods", async () => {
  const calls = [];
  const provider = new ApplicationDynamicCommandProvider({
    queries: {
      listAdapters() {
        calls.push("adapter.list");
        return { adapters: [{ id: "demo", summary: "Demo" }] };
      },
      listConfiguredDevices() {
        calls.push("device.list");
        return { devices: [{ id: "board", adapter: "demo" }] };
      },
      listSystems() {
        calls.push("system.list");
        return { systems: [{ id: "lab", name: "Lab" }] };
      },
      async deviceCapabilities() {
        calls.push("device.capabilities");
        return {
          adapter: { id: "demo" },
          capabilities: [
            {
              id: "flash",
              summary: "Flash",
              options: [],
              defaultTimeoutMs: 1000,
              lockMode: "exclusive",
              createsRun: true,
              safety: { mode: "destructive", flag: "confirm-flash" },
              availability: "available",
            },
          ],
        };
      },
    },
    systems: {
      async describe() {
        calls.push("system.capabilities");
        return { capabilities: [] };
      },
    },
    runtime: {
      async listRuns() {
        calls.push("run.list");
        return { runs: [{ id: "run-1" }] };
      },
      async listLocks() {
        calls.push("lock.list");
        return { locks: [{ lockId: "lock-1" }], corrupt: [] };
      },
      async listApprovals() {
        calls.push("approval.list");
        return { approvals: [{ id: "approval-1" }] };
      },
      async pruneRuns() {
        assert.fail("provider must not mutate runs");
      },
      async clearLock() {
        assert.fail("provider must not mutate locks");
      },
      async approveApproval() {
        assert.fail("provider must not mutate approvals");
      },
    },
  });
  assert.equal(
    (
      await provider.values({
        provider: "adapters",
        captures: {},
        definition: {},
      })
    )[0].value,
    "demo",
  );
  assert.equal(
    (
      await provider.values({
        provider: "device-capabilities",
        captures: { device: "board" },
        definition: {},
      })
    )[0].options.at(-1).name,
    "confirm-flash",
  );
  for (const family of ["runs", "locks", "approvals"])
    assert.equal(
      (
        await provider.values({
          provider: family,
          captures: {},
          definition: {},
        })
      )[0].value.endsWith("-1"),
      true,
    );
  assert.deepEqual(calls, [
    "adapter.list",
    "device.capabilities",
    "run.list",
    "lock.list",
    "approval.list",
  ]);
});

test("record providers are empty outside a project", async () => {
  const provider = new ApplicationDynamicCommandProvider({
    queries: {},
    systems: {},
    runtime: {
      async listRuns() {
        throw new BenchPilotError("PROJECT_NOT_FOUND", 3, "project required");
      },
    },
  });
  assert.deepEqual(
    await provider.values({
      provider: "runs",
      captures: {},
      definition: {},
    }),
    [],
  );
});
