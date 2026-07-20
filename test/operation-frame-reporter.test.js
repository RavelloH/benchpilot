import assert from "node:assert/strict";
import test from "node:test";
import { OperationFrameReporter } from "../dist/cli/output/operation-frame-reporter.js";

const result = {
  schema: "benchpilot.result",
  version: 3,
  ok: true,
  command: { id: "device.execute", path: ["device", "demo", "build"] },
  kind: "operation",
  data: { schema: "benchpilot.capability-outcome", version: 1 },
  meta: {
    startedAt: "2026-07-20T00:00:00.000Z",
    endedAt: "2026-07-20T00:00:01.000Z",
    durationMs: 1000,
    dryRun: false,
  },
};

test("operation frame reporter streams domain events in one v3 command sequence", () => {
  const output = [];
  const reporter = new OperationFrameReporter(
    { write: (value) => output.push(value) },
    result.command,
  );
  reporter.emit("operation.started", { runId: "run-1" });
  reporter.child({ system: "all", device: "demo" }).emit("stage.completed", {
    stage: "build",
  });
  reporter.complete({ type: "command.completed", result });
  const events = output.map((line) => JSON.parse(line));
  assert.deepEqual(
    events.map((event) => event.event.type),
    [
      "command.started",
      "operation.started",
      "operation.stage.completed",
      "command.completed",
    ],
  );
  assert.deepEqual(
    events.map((event) => event.sequence),
    [0, 1, 2, 3],
  );
  assert.deepEqual(events[2].context, { system: "all", device: "demo" });
  assert.deepEqual(events.at(-1).event.result, result);
});
