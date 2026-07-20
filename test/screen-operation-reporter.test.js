import assert from "node:assert/strict";
import test from "node:test";
import { ScreenOperationReporter } from "../dist/cli/output/screen-operation-reporter.js";

const labels = {
  preparing: "Preparing",
  running: "Running",
  cleaning: "Cleaning up",
  completing: "Finishing",
};

const coloredTheme = {
  argument: (value) => `<accent>${value}</accent>`,
  muted: (value) => `<muted>${value}</muted>`,
  success: (value) => `<success>${value}</success>`,
  error: (value) => `<error>${value}</error>`,
};

test("screen operation reporter replaces one loading line and clears it on completion", () => {
  const updates = [];
  const removed = [];
  const reporter = new ScreenOperationReporter(
    {
      write() {},
      append() {},
      update(key, value) {
        updates.push({ key, value });
      },
      remove(key) {
        removed.push(key);
      },
      close() {},
    },
    labels,
    {},
    undefined,
    coloredTheme,
  );

  reporter.emit("operation.started");
  reporter.child({ device: "demo" }).emit("stage.started", {
    stage: "flash",
  });
  reporter.emit("operation.completed");

  assert.deepEqual(
    updates.map((update) => update.key),
    ["operation.progress", "operation.progress"],
  );
  assert.equal(updates[0].value, "<accent>⣾</accent> <muted>Preparing</muted>");
  assert.equal(
    updates[1].value,
    "<accent>⣾</accent> <muted>Running demo flash</muted>",
  );
  assert.deepEqual(removed, ["operation.progress"]);
});

test("screen operation reporter keeps workflow steps below the main loading line", () => {
  const updates = [];
  const reporter = new ScreenOperationReporter(
    {
      write() {},
      append() {},
      update(_key, value) {
        updates.push(value);
      },
      remove() {},
      close() {},
    },
    labels,
    {},
    undefined,
    coloredTheme,
  );
  reporter.configure(labels, (_adapter, key, fallback) =>
    key === "progress.status.project" ? "Inspect project" : fallback,
  );

  reporter.emit("stage.started", { stage: "status" });
  const workflow = reporter.child({ adapter: "fixture" });
  workflow.emit("adapter.workflow.started", {
    workflowId: "status",
    steps: [
      {
        stepId: "project",
        label: { key: "progress.status.project", fallback: "Project" },
      },
      {
        stepId: "python",
        label: { key: "progress.status.python", fallback: "Check Python" },
      },
    ],
  });
  assert.equal(
    updates.at(-1),
    [
      "<accent>⣾</accent> <muted>Running status</muted>",
      "  <muted>-</muted> <muted>Inspect project</muted>",
      "  <muted>-</muted> <muted>Check Python</muted>",
    ].join("\n"),
  );
  workflow.emit("adapter.workflow.step.started", {
    workflowId: "status",
    stepId: "project",
    label: { key: "progress.status.project", fallback: "Project" },
  });
  workflow.emit("adapter.workflow.step.completed", {
    workflowId: "status",
    stepId: "project",
    label: { key: "progress.status.project", fallback: "Project" },
  });
  workflow.emit("adapter.workflow.step.started", {
    workflowId: "status",
    stepId: "python",
    label: { key: "progress.status.python", fallback: "Check Python" },
  });

  assert.equal(
    updates.at(-1),
    [
      "<accent>⣾</accent> <muted>Running status</muted>",
      "  <success>✓</success> <muted>Inspect project</muted>",
      "  <accent>⣾</accent> <muted>Check Python</muted>",
    ].join("\n"),
  );
  reporter.complete();
});

test("screen operation reporter projects adapter parser events as live steps", () => {
  const updates = [];
  const reporter = new ScreenOperationReporter(
    {
      write() {},
      append() {},
      update(_key, value) {
        updates.push(value);
      },
      remove() {},
      close() {},
    },
    labels,
    {},
    undefined,
    coloredTheme,
  );
  reporter.configure(labels);
  const adapter = reporter.child({ adapter: "esp-idf" });

  adapter.emit("stage.started", { stage: "build" });
  adapter.emit("esp-idf.configure", {
    label: { key: "progress.build.configure", fallback: "Configure CMake" },
    state: "running",
  });
  adapter.emit("esp-idf.build.progress", {
    current: 12,
    total: 20,
    label: { key: "progress.build.compiling", fallback: "Compile sources" },
    state: "running",
  });

  assert.equal(
    updates.at(-1),
    [
      "<accent>⣾</accent> <muted>Running build</muted>",
      "  <success>✓</success> <muted>Configure CMake</muted>",
      "  <accent>⣾</accent> <muted>Compile sources (12/20)</muted>",
    ].join("\n"),
  );
  reporter.complete();
});

test("screen operation reporter nests adapter parser events under their workflow step", () => {
  const updates = [];
  const reporter = new ScreenOperationReporter(
    {
      write() {},
      append() {},
      update(_key, value) {
        updates.push(value);
      },
      remove() {},
      close() {},
    },
    labels,
    {},
    undefined,
    coloredTheme,
  );
  const workflow = reporter.child({ adapter: "esp-idf" });
  reporter.emit("stage.started", { stage: "build" });
  workflow.emit("adapter.workflow.started", {
    workflowId: "build",
    steps: [
      { stepId: "build", label: { key: "build", fallback: "Build project" } },
      {
        stepId: "metadata",
        label: { key: "metadata", fallback: "Read build metadata" },
      },
    ],
  });
  workflow.emit("adapter.workflow.step.started", {
    workflowId: "build",
    stepId: "build",
    label: { key: "build", fallback: "Build project" },
  });
  workflow.emit("esp-idf.configure", {
    label: { key: "configure", fallback: "Configure CMake project" },
    state: "running",
    workflowStep: { workflowId: "build", stepId: "build" },
  });
  workflow.emit("esp-idf.build.progress", {
    current: 81,
    total: 1565,
    label: { key: "compiling", fallback: "Compile source files" },
    state: "running",
    workflowStep: { workflowId: "build", stepId: "build" },
  });
  workflow.emit("esp-idf.configure", {
    label: { key: "configure", fallback: "Configure CMake project" },
    state: "running",
    workflowStep: { workflowId: "build", stepId: "build" },
  });
  workflow.emit("esp-idf.build.progress", {
    current: 3,
    total: 3,
    label: { key: "compiling", fallback: "Compile source files" },
    state: "running",
    workflowStep: { workflowId: "build", stepId: "build" },
  });

  assert.equal(
    updates.at(-1),
    [
      "<accent>⣾</accent> <muted>Running build</muted>",
      "  <accent>⣾</accent> <muted>Build project</muted>",
      "    <success>✓</success> <muted>Configure CMake project</muted>",
      "    <accent>⣾</accent> <muted>Compile source files (81/1565)</muted>",
      "  <muted>-</muted> <muted>Read build metadata</muted>",
    ].join("\n"),
  );
  reporter.complete();
});

test("screen operation reporter restarts declared progress cycles for serial flash images", () => {
  const updates = [];
  const reporter = new ScreenOperationReporter(
    {
      write() {},
      append() {},
      update(_key, value) {
        updates.push(value);
      },
      remove() {},
      close() {},
    },
    labels,
    {},
    undefined,
    coloredTheme,
  );
  const adapter = reporter.child({ adapter: "esp-idf" });
  adapter.emit("stage.started", { stage: "flash" });
  adapter.emit("esp-idf.flash.connecting", {
    label: { key: "connect", fallback: "Connect to ESP target" },
    state: "running",
  });
  adapter.emit("esp-idf.flash.progress", {
    label: { key: "write", fallback: "Write firmware" },
    state: "running",
    reentrant: true,
    cycle: {
      id: "image",
      start_field: "current",
      start_value: 0,
      label: { key: "image", fallback: "Flash image" },
    },
    address: "0x00000000",
    percent: 0,
    current: 0,
    total: 1024,
  });
  adapter.emit("esp-idf.flash.progress", {
    label: { key: "write", fallback: "Write firmware" },
    state: "running",
    reentrant: true,
    cycle: {
      id: "image",
      start_field: "current",
      start_value: 0,
      label: { key: "image", fallback: "Flash image" },
    },
    address: "0x00000400",
    percent: 100,
    current: 1024,
    total: 1024,
  });
  adapter.emit("esp-idf.flash.verifying", {
    label: { key: "verify", fallback: "Verify flashed data" },
    state: "running",
    cycle: {
      id: "image",
      start_field: "current",
      start_value: 0,
      label: { key: "image", fallback: "Flash image" },
    },
  });
  adapter.emit("esp-idf.flash.verifying", {
    label: { key: "verify", fallback: "Verify flashed data" },
    state: "completed",
    cycle: {
      id: "image",
      start_field: "current",
      start_value: 0,
      label: { key: "image", fallback: "Flash image" },
    },
    cycleComplete: true,
  });
  adapter.emit("esp-idf.flash.progress", {
    label: { key: "write", fallback: "Write firmware" },
    state: "running",
    reentrant: true,
    cycle: {
      id: "image",
      start_field: "current",
      start_value: 0,
      label: { key: "image", fallback: "Flash image" },
    },
    address: "0x00020000",
    percent: 0,
    current: 0,
    total: 2048,
  });
  adapter.emit("esp-idf.flash.progress", {
    label: { key: "write", fallback: "Write firmware" },
    state: "running",
    reentrant: true,
    cycle: {
      id: "image",
      start_field: "current",
      start_value: 0,
      label: { key: "image", fallback: "Flash image" },
    },
    address: "0x00020200",
    percent: 25,
    current: 512,
    total: 2048,
  });

  assert.equal(
    updates.at(-1),
    [
      "<accent>⣾</accent> <muted>Running flash</muted>",
      "  <success>✓</success> <muted>Connect to ESP target</muted>",
      "  <success>✓</success> <muted>Flash image (0x00000000, 1 KiB)</muted>",
      "    <success>✓</success> <muted>Write firmware (100%, 1 KiB/1 KiB)</muted>",
      "    <success>✓</success> <muted>Verify flashed data</muted>",
      "  <accent>⣾</accent> <muted>Flash image (0x00020000, 2 KiB)</muted>",
      "    <accent>⣾</accent> <muted>Write firmware (25%, 512 B/2 KiB)</muted>",
    ].join("\n"),
  );
  reporter.complete();
});

test("screen operation reporter merges mutually exclusive workflow variants", () => {
  const updates = [];
  const reporter = new ScreenOperationReporter(
    {
      write() {},
      append() {},
      update(_key, value) {
        updates.push(value);
      },
      remove() {},
      close() {},
    },
    labels,
    {},
    undefined,
    coloredTheme,
  );
  const workflow = reporter.child({ adapter: "esp-idf" });
  reporter.emit("stage.started", { stage: "info" });
  workflow.emit("adapter.workflow.started", {
    workflowId: "info",
    steps: [
      {
        stepId: "chip-v5",
        displayId: "chip",
        label: { key: "progress.info.chip", fallback: "Read chip identity" },
      },
      {
        stepId: "chip-v4",
        displayId: "chip",
        label: { key: "progress.info.chip", fallback: "Read chip identity" },
      },
    ],
  });
  assert.equal((updates.at(-1).match(/Read chip identity/g) ?? []).length, 1);
  workflow.emit("adapter.workflow.step.completed", {
    workflowId: "info",
    stepId: "chip-v5",
    displayId: "chip",
    label: { key: "progress.info.chip", fallback: "Read chip identity" },
  });
  workflow.emit("adapter.workflow.step.skipped", {
    workflowId: "info",
    stepId: "chip-v4",
    displayId: "chip",
    label: { key: "progress.info.chip", fallback: "Read chip identity" },
  });
  assert.match(
    updates.at(-1),
    /<success>✓<\/success> <muted>Read chip identity<\/muted>/,
  );
  reporter.complete();
});

test("screen operation reporter waits for its presentation configuration", () => {
  const updates = [];
  const reporter = new ScreenOperationReporter({
    write() {},
    append() {},
    update(key, value) {
      updates.push({ key, value });
    },
    remove() {},
    close() {},
  });

  reporter.emit("operation.started");
  reporter.configure(labels);
  reporter.emit("operation.started");

  assert.equal(updates.length, 1);
  assert.match(updates[0].value, /Preparing/);
  reporter.complete();
});
