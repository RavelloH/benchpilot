import assert from "node:assert/strict";
import test from "node:test";
import { OutputEngine } from "../dist/cli/output/engine.js";
import {
  commandFailureResult,
  renderFailure,
} from "../dist/cli/output/failure.js";
import { BenchPilotError } from "../dist/core.js";

const definition = {
  command: { id: "fixture", path: ["fixture"] },
  kind: "data",
  data: { schema: "fixture.data", version: 1, value: "same-data" },
  snapshots: [
    {
      key: "fixture",
      value: { schema: "fixture.data", version: 1, value: "same-data" },
    },
  ],
  renderScreen(data) {
    return `${data.value}\n`;
  },
};

const clock = () => {
  let second = 0;
  return () => new Date(`2026-01-01T00:00:0${second++}.000Z`);
};

test("static output uses one semantic data object for screen and JSON", () => {
  const screen = [];
  new OutputEngine({
    mode: "screen",
    locale: "en",
    color: false,
    columns: 80,
    output: { write: (value) => screen.push(value) },
    clock: clock(),
  }).render(definition);
  assert.deepEqual(screen, ["same-data\n"]);

  const json = [];
  const result = new OutputEngine({
    mode: "json",
    locale: "en",
    color: false,
    columns: 80,
    output: { write: (value) => json.push(value) },
    clock: clock(),
  }).render(definition);
  assert.deepEqual(JSON.parse(json.join("")), result);
  assert.equal(result.data, definition.data);
});

test("JSONL terminal embeds exactly the JSON result", () => {
  const output = [];
  const result = new OutputEngine({
    mode: "jsonl",
    locale: "en",
    color: false,
    columns: 80,
    output: { write: (value) => output.push(value) },
    clock: clock(),
  }).render(definition);
  const events = output
    .join("")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.deepEqual(
    events.map((event) => event.event.type),
    ["command.started", "snapshot", "command.completed"],
  );
  assert.deepEqual(events.at(-1).event.result, result);
  assert.deepEqual(
    events.map((event) => event.sequence),
    [0, 1, 2],
  );
});

test("JSON and JSONL failures share one Result v3 terminal", () => {
  const command = { id: "config.get", path: ["config", "get"] };
  const result = commandFailureResult({
    command,
    error: new BenchPilotError("USAGE_ERROR", 2, "invalid input"),
    startedAt: new Date("2026-01-01T00:00:00.000Z"),
    endedAt: new Date("2026-01-01T00:00:01.000Z"),
  });
  assert.equal(result.error.message, undefined);
  assert.deepEqual(result.error.messageRef, { key: "error.reason.usageError" });
  const json = [];
  renderFailure({
    result,
    command,
    flags: { json: true },
    legacyOperation: false,
    terminalEmitted: false,
    humanMessage: "unused",
    sink: { stdout: { write: (value) => json.push(value) }, stderr: {} },
  });
  assert.deepEqual(JSON.parse(json.join("")), result);

  const jsonl = [];
  renderFailure({
    result,
    command,
    flags: { jsonl: true },
    legacyOperation: false,
    terminalEmitted: false,
    humanMessage: "unused",
    sink: { stdout: { write: (value) => jsonl.push(value) }, stderr: {} },
  });
  const events = jsonl
    .join("")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.deepEqual(
    events.map((event) => event.event.type),
    ["command.started", "command.failed"],
  );
  assert.deepEqual(
    events.map((event) => event.sequence),
    [0, 1],
  );
  assert.equal(events[1].schema, "benchpilot.event");
  assert.equal(events[1].version, 3);
  assert.deepEqual(events[1].event.result, result);
});
