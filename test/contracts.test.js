import assert from "node:assert/strict";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import {
  CliEventEncoder,
  OutputFrameSequenceError,
  cliEventV3Schema,
  commandResultV3Schema,
  messageRef,
  reduceOutputFrames,
} from "../dist/index.js";

const command = { id: "device.status", path: ["device", "demo", "status"] };
const startedAt = "2026-07-19T00:00:00.000Z";
const endedAt = "2026-07-19T00:00:01.000Z";
const result = {
  schema: "benchpilot.result",
  version: 3,
  ok: true,
  command,
  kind: "operation",
  data: { schema: "benchpilot.device-status", version: 1, ready: true },
  meta: { startedAt, endedAt, durationMs: 1000, runId: "run-1" },
};

test("v3 result and event schemas compile and accept a terminal stream", () => {
  const ajv = new Ajv2020({ strict: true, allErrors: true });
  addFormats(ajv);
  ajv.addSchema(commandResultV3Schema);
  const validateResult = ajv.getSchema("benchpilot://schemas/result/v3");
  const validateEvent = ajv.compile(cliEventV3Schema);
  assert.equal(
    validateResult(result),
    true,
    JSON.stringify(validateResult.errors),
  );

  const times = [startedAt, startedAt, endedAt];
  const encoder = new CliEventEncoder({
    command,
    clock: () => new Date(times.shift()),
  });
  const events = [
    encoder.encode({ type: "command.started" }),
    encoder.encode({
      type: "snapshot",
      key: "device",
      value: { ready: false },
    }),
    encoder.encode({ type: "command.completed", result }),
  ];
  assert.deepEqual(
    events.map((event) => event.sequence),
    [0, 1, 2],
  );
  for (const event of events)
    assert.equal(
      validateEvent(event),
      true,
      JSON.stringify(validateEvent.errors),
    );
  assert.deepEqual(events.at(-1).event.result, result);
});

test("output frames reduce keyed replacement, append, progress, and notices", () => {
  const state = reduceOutputFrames([
    { type: "command.started" },
    { type: "snapshot", key: "device", value: { ready: false } },
    { type: "update", key: "device", value: { ready: true } },
    { type: "append", key: "lines", value: "first" },
    { type: "append", key: "lines", value: "second" },
    { type: "progress", key: "build", current: 5, total: 10 },
    {
      type: "notice",
      level: "success",
      message: messageRef("operation.ready"),
    },
    { type: "operation.stage.completed", data: { stage: "build" } },
    { type: "command.completed", result },
  ]);
  assert.deepEqual(state.snapshots.device, { ready: true });
  assert.deepEqual(state.appended.lines, ["first", "second"]);
  assert.deepEqual(state.progress.build, { current: 5, total: 10 });
  assert.equal(state.notices.length, 1);
  assert.equal(state.lifecycle.length, 1);
  assert.deepEqual(state.terminal, result);
});

test("output frame reducer rejects malformed terminal sequences", () => {
  assert.throws(
    () => reduceOutputFrames([{ type: "command.completed", result }]),
    OutputFrameSequenceError,
  );
  assert.throws(
    () =>
      reduceOutputFrames([
        { type: "command.started" },
        { type: "command.failed", result },
      ]),
    /does not match result\.ok/,
  );
  assert.throws(
    () =>
      reduceOutputFrames([
        { type: "command.started" },
        { type: "command.completed", result },
        { type: "append", key: "late", value: true },
      ]),
    /No frame may follow/,
  );
});
