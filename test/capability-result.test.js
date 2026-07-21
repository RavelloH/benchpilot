import assert from "node:assert/strict";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { commandResultV3Schema } from "../dist/contracts/index.js";
import { BenchPilotError } from "../dist/core.js";
import {
  capabilityOutcomeFromOperation,
  capabilityResultFromOperation,
  capabilityResultFromSystem,
} from "../dist/cli/output/capability-result.js";
import { renderCapabilityResult } from "../dist/cli/output/capability-renderer.js";

const outcome = {
  status: "succeeded",
  command: "device.build",
  subject: {
    adapter: "fixture",
    capability: "build",
    device: { instance: "demo", physicalId: "fixture-01" },
  },
  execution: {
    status: "succeeded",
    startedAt: "2026-07-20T00:00:00.000Z",
    endedAt: "2026-07-20T00:00:01.000Z",
    durationMs: 1000,
    runId: "run-1",
    dryRun: false,
  },
  output: { imageBytes: 42 },
  artifacts: [
    {
      name: "firmware",
      kind: "firmware",
      path: "artifacts/firmware.bin",
      size: 42,
      sha256: "a".repeat(64),
      createdAt: "2026-07-20T00:00:01.000Z",
    },
  ],
  result: {},
  cleanupErrors: [],
  lockFinalStatus: "released",
};

test("operation facts map to one public capability outcome", () => {
  const data = capabilityOutcomeFromOperation(outcome);
  assert.deepEqual(data.subject, {
    scope: "device",
    adapter: "fixture",
    capability: "build",
    device: { instance: "demo", physicalId: "fixture-01" },
  });
  assert.deepEqual(data.output, { imageBytes: 42 });
  assert.equal(data.artifacts[0].sha256, "a".repeat(64));

  const result = capabilityResultFromOperation({
    command: { id: "device.execute", path: ["device", "demo", "build"] },
    outcome,
  });
  const ajv = new Ajv2020({ strict: true, allErrors: true });
  addFormats(ajv);
  const validate = ajv.compile(commandResultV3Schema);
  assert.equal(validate(result), true, JSON.stringify(validate.errors));
  assert.deepEqual(result.data, data);
});

test("failed operation results retain the same outcome and structured error", () => {
  const failed = {
    ...outcome,
    status: "failed",
    execution: { ...outcome.execution, status: "failed" },
    output: undefined,
    primaryError: new BenchPilotError("OPERATION_TIMEOUT", 6, "timed out"),
  };
  const result = capabilityResultFromOperation({
    command: { id: "device.execute", path: ["device", "demo", "build"] },
    outcome: failed,
  });
  assert.equal(result.ok, false);
  assert.equal(result.data.execution.status, "failed");
  assert.equal(result.error.kind, "OPERATION_TIMEOUT");
  const ajv = new Ajv2020({ strict: true, allErrors: true });
  addFormats(ajv);
  const validate = ajv.compile(commandResultV3Schema);
  assert.equal(validate(result), true, JSON.stringify(validate.errors));
});

test("uncatalogued adapter failures retain their concrete diagnostic message on screen", () => {
  const result = capabilityResultFromOperation({
    command: { id: "device.execute", path: ["device", "demo", "info"] },
    outcome: {
      ...outcome,
      status: "failed",
      execution: { ...outcome.execution, status: "failed" },
      output: undefined,
      primaryError: new BenchPilotError(
        "ADAPTER_PARSER_FAILED",
        5,
        "Parser matched ESP_DEVICE_NOT_FOUND.",
        true,
        undefined,
        ["Reconnect the device and verify the selected port."],
        {
          messageRef: {
            key: "error.device_not_found",
            fallback: "No ESP target responded.",
          },
        },
      ),
    },
  });
  const output = [];
  renderCapabilityResult({
    result,
    flags: {},
    output: { write: (value) => output.push(value) },
    locale: "zh-CN",
    color: false,
    columns: 80,
    adapterId: "fixture",
    translate: (_locale, key) =>
      key === "error.device_not_found"
        ? "所选串口上的设备没有响应。"
        : undefined,
  });

  assert.match(output.join(""), /所选串口上的设备没有响应。/);
  assert.doesNotMatch(output.join(""), /Parser matched ESP_DEVICE_NOT_FOUND/);
  assert.doesNotMatch(output.join(""), /发生了未预期的内部错误/);
});

test("system operation results retain member outcomes without inventing an adapter", () => {
  const result = capabilityResultFromSystem({
    command: { id: "system.execute", path: ["system", "lab", "build"] },
    result: {
      system: "lab",
      capability: "build",
      policy: "parallel",
      results: [{ device: "demo", ok: true, result: {}, outcome }],
    },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.data.subject, {
    scope: "system",
    adapters: ["fixture"],
    capability: "build",
    system: { instance: "lab" },
  });
  assert.equal(result.data.members[0].outcome.output.imageBytes, 42);
});

test("adapter views localize only the common screen projection", () => {
  const result = capabilityResultFromOperation({
    command: { id: "device.execute", path: ["device", "demo", "build"] },
    outcome,
  });
  const output = [];
  renderCapabilityResult({
    result,
    flags: {},
    output: { write: (value) => output.push(value) },
    locale: "zh-CN",
    color: false,
    columns: 80,
    adapterId: "fixture",
    translate: (_locale, key) =>
      ({ "view.build.title": "构建结果", "view.build.bytes": "镜像大小" })[key],
    view: {
      kind: "detail",
      title: { key: "view.build.title", fallback: "Build" },
      fields: [
        {
          selector: "imageBytes",
          label: { key: "view.build.bytes", fallback: "Image bytes" },
          formatter: "string",
        },
      ],
    },
  });
  assert.match(output.join(""), /执行\n  状态/);
  assert.doesNotMatch(output.join(""), /操作|演练运行/);
  assert.match(output.join(""), /构建结果\n  镜像大小/);
  assert.deepEqual(result.data.output, { imageBytes: 42 });

  const withoutArtifacts = [];
  renderCapabilityResult({
    result: { ...result, data: { ...result.data, artifacts: [] } },
    flags: {},
    output: { write: (value) => withoutArtifacts.push(value) },
    locale: "zh-CN",
    color: false,
    columns: 80,
  });
  assert.doesNotMatch(withoutArtifacts.join(""), /产物/);
});

test("adapter key-value tables retain raw paths beside translated names", () => {
  const result = capabilityResultFromOperation({
    command: { id: "device.execute", path: ["device", "demo", "info"] },
    outcome: {
      ...outcome,
      subject: { ...outcome.subject, capability: "info" },
      output: {
        detect: { version: "5.3.0", major: 5 },
        chip: { chip: "ESP32-S3", revision: "0.2" },
      },
    },
  });
  const output = [];
  renderCapabilityResult({
    result,
    flags: {},
    output: { write: (value) => output.push(value) },
    locale: "zh-CN",
    color: false,
    columns: 100,
    adapterId: "fixture",
    translate: (_locale, key) =>
      ({
        "view.info.title": "设备信息",
        "view.info.key.version": "版本",
        "view.info.key.major": "主版本",
        "view.info.key.chip": "芯片",
        "view.info.key.revision": "修订版本",
      })[key],
    view: {
      kind: "table",
      title: { key: "view.info.title", fallback: "Information" },
      keys: {
        version: { key: "view.info.key.version", fallback: "Version" },
        major: { key: "view.info.key.major", fallback: "Major" },
        chip: { key: "view.info.key.chip", fallback: "Chip" },
        revision: { key: "view.info.key.revision", fallback: "Revision" },
      },
    },
  });

  assert.match(output.join(""), /键\s+名称\s+值/);
  assert.match(output.join(""), /detect\.version\s+版本\s+5\.3\.0/);
  assert.match(output.join(""), /chip\.revision\s+修订版本\s+0\.2/);
});

test("adapter record tables render bounded session logs without changing data", () => {
  const result = capabilityResultFromOperation({
    command: { id: "device.execute", path: ["device", "demo", "logs"] },
    outcome: {
      ...outcome,
      subject: { ...outcome.subject, capability: "logs" },
      output: {
        records: [
          {
            sequence: 7,
            timestamp: "2026-07-22T00:00:00.000Z",
            text: "boot complete",
          },
        ],
      },
    },
  });
  const output = [];
  renderCapabilityResult({
    result,
    flags: {},
    output: { write: (value) => output.push(value) },
    locale: "zh-CN",
    color: false,
    columns: 120,
    adapterId: "fixture",
    translate: (_locale, key) =>
      ({
        "view.logs.title": "串口会话日志",
        "view.logs.time": "时间",
        "view.logs.sequence": "序号",
        "view.logs.output": "输出",
      })[key],
    view: {
      kind: "records",
      title: { key: "view.logs.title", fallback: "Serial logs" },
      source: "records",
      columns: [
        {
          selector: "timestamp",
          label: { key: "view.logs.time", fallback: "Time" },
          formatter: "string",
        },
        {
          selector: "sequence",
          label: { key: "view.logs.sequence", fallback: "#" },
          formatter: "string",
        },
        {
          selector: "text",
          label: { key: "view.logs.output", fallback: "Output" },
          formatter: "fallback-dash",
        },
      ],
    },
  });
  assert.match(output.join(""), /串口会话日志/);
  assert.match(output.join(""), /时间\s+序号\s+输出/);
  assert.match(
    output.join(""),
    /2026-07-22T00:00:00\.000Z\s+7\s+boot complete/,
  );
  assert.deepEqual(result.data.output, {
    records: [
      {
        sequence: 7,
        timestamp: "2026-07-22T00:00:00.000Z",
        text: "boot complete",
      },
    ],
  });
});

test("adapter completion views hide workflow internals only after success", () => {
  const result = capabilityResultFromOperation({
    command: { id: "device.execute", path: ["device", "demo", "reset"] },
    outcome: {
      ...outcome,
      subject: { ...outcome.subject, capability: "reset" },
      output: { detect: { version: "5.3.0" }, "reset-v5": {} },
    },
  });
  const output = [];
  renderCapabilityResult({
    result,
    flags: {},
    output: { write: (value) => output.push(value) },
    locale: "zh-CN",
    color: false,
    columns: 80,
    adapterId: "fixture",
    translate: (_locale, key) =>
      key === "view.reset.completed" ? "设备已复位。" : undefined,
    view: {
      kind: "completion",
      message: {
        key: "view.reset.completed",
        fallback: "Device reset completed.",
      },
    },
  });
  assert.match(output.join(""), /设备已复位。/);
  assert.doesNotMatch(output.join(""), /detect\.version|reset-v5/);

  const failed = [];
  renderCapabilityResult({
    result: { ...result, ok: false },
    flags: {},
    output: { write: (value) => failed.push(value) },
    locale: "zh-CN",
    color: false,
    columns: 80,
    view: {
      kind: "completion",
      message: {
        key: "view.reset.completed",
        fallback: "Device reset completed.",
      },
    },
  });
  assert.doesNotMatch(failed.join(""), /Device reset completed/);
  assert.match(failed.join(""), /detect\.version/);
});

test("adapter detail views render their declared empty state after an aborted operation", () => {
  const result = capabilityResultFromOperation({
    command: { id: "device.execute", path: ["device", "demo", "status"] },
    outcome: {
      ...outcome,
      status: "aborted",
      execution: { ...outcome.execution, status: "aborted", runId: undefined },
      output: undefined,
      primaryError: new BenchPilotError(
        "OPERATION_ABORTED",
        6,
        "operation aborted",
      ),
    },
  });
  const output = [];
  renderCapabilityResult({
    result,
    flags: {},
    output: { write: (value) => output.push(value) },
    locale: "en",
    color: false,
    columns: 80,
    adapterId: "fixture",
    view: {
      kind: "detail",
      title: { key: "view.status.title", fallback: "Status" },
      empty: { key: "view.status.empty", fallback: "No status data." },
      fields: [
        {
          selector: "target",
          label: { key: "view.field.target", fallback: "Target" },
          formatter: "string",
        },
      ],
    },
  });

  assert.match(output.join(""), /Status\n  No status data\./);
  assert.match(
    output.join(""),
    /Diagnostics\n  Error\s+The operation was aborted\./,
  );
  assert.doesNotMatch(output.join(""), /Run\s+—/);
});
