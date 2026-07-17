import assert from "node:assert/strict";
import test from "node:test";
import { BenchPilotError } from "../dist/index.js";
import {
  executeSystemCapability,
  systemCapabilityIntersection,
} from "../dist/application/systems/use-case.js";

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
