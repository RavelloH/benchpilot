import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { commandCatalogDefinition } from "../dist/application/commands/definitions.js";
import {
  adapterConfigurationDataPage,
  adapterDoctorDataPage,
  adapterInfoDataPage,
  adapterListDataPage,
} from "../dist/cli/data/adapter.js";
import { doctorDataPage } from "../dist/cli/data/doctor.js";
import { approvalDetailDataPage } from "../dist/cli/data/approval.js";
import {
  languageDataPage,
  languageListDataPage,
} from "../dist/cli/data/language.js";
import {
  configGetDataPage,
  configExplainDataPage,
  configMutationDataPage,
  configResolvedDataPage,
  configValidateDataPage,
} from "../dist/cli/data/config.js";
import {
  deviceAddedDataPage,
  deviceListDataPage,
  deviceRemovedDataPage,
  deviceScanDataPage,
  systemDetailDataPage,
  systemListDataPage,
} from "../dist/cli/data/resource.js";
import {
  runArtifactsDataPage,
  runDetailDataPage,
  runListDataPage,
  runLogDataPage,
  runPruneDataPage,
} from "../dist/cli/data/run.js";
import { initDataPage } from "../dist/cli/data/init.js";
import { stripTerminalText } from "../dist/cli/terminal/text.js";
import { renderDataView } from "../dist/cli/views/data-screen-renderer.js";
import { formatDataCell } from "../dist/cli/views/data-formatters.js";
import {
  upgradeCheckDataPage,
  upgradeResultDataPage,
} from "../dist/cli/data/upgrade.js";

const commandIds = ["adapter.list", "device.list", "system.list", "run.list"];
const commandViews = commandIds.map(
  (id) =>
    commandCatalogDefinition.commands.find((command) => command.id === id)
      .output.view,
);

const details = () => [
  [
    "adapter.show",
    adapterInfoDataPage({
      id: "esp-idf",
      version: "1.2.3",
      summary: "ESP-IDF adapter",
    }),
  ],
  [
    "device.add",
    deviceAddedDataPage({
      instance: "board-a",
      adapter: "esp-idf",
      identity: "usb:1234",
      port: "COM7",
      path: "C:/project/.benchpilot/config.toml",
    }),
  ],
  [
    "device.remove",
    deviceRemovedDataPage({
      instance: "board-a",
      path: "C:/project/.benchpilot/config.toml",
    }),
  ],
];

const configDetails = () => [
  [
    "config.get",
    configGetDataPage({
      key: "approval.level",
      value: "strict",
      origin: { scope: "project", path: "C:/project/benchpilot.toml" },
    }),
  ],
  ["config.validate", configValidateDataPage()],
  [
    "config.set",
    configMutationDataPage({
      action: "set",
      key: "approval.level",
      value: "strict",
      scope: "project",
      path: "C:/project/benchpilot.toml",
    }),
  ],
  [
    "config.unset",
    configMutationDataPage({
      action: "unset",
      key: "approval.level",
      scope: "project",
      path: "C:/project/benchpilot.toml",
    }),
  ],
];

const initPages = () => {
  const common = {
    created: "C:/project/benchpilot.toml",
    config: {},
    project: { id: "demo", name: "Demo" },
    adapters: { enabled: ["esp-idf", "demo"] },
  };
  return [
    initDataPage({ ...common, existing: false }),
    initDataPage({ ...common, existing: true }),
  ];
};

const pages = () => [
  adapterListDataPage({
    adapters: [
      { id: "esp-idf", version: "1.2.3", summary: "ESP-IDF adapter" },
      { id: "demo", version: "0.1.0", summary: "Demo adapter" },
    ],
  }),
  deviceListDataPage({
    devices: [
      { id: "board-a", adapter: "esp-idf" },
      { id: "board-b", adapter: "demo" },
    ],
  }),
  systemListDataPage({
    systems: [
      {
        id: "pair",
        members: [{ device: "board-a" }, { device: "board-b" }],
      },
    ],
  }),
  runListDataPage({
    runs: [
      {
        id: "run-001",
        manifest: {
          status: "succeeded",
          command: "device board-a status",
        },
      },
      {
        id: "run-002",
        manifest: { status: "failed", command: "device board-b flash" },
      },
    ],
  }),
];

const renderLists = (locale, color = false) =>
  pages()
    .map((page, index) =>
      renderDataView(commandViews[index], page.data, {
        locale,
        color,
        columns: 80,
      }),
    )
    .join("\n");

const renderDetails = (locale, color = false) =>
  details()
    .map(([view, page]) =>
      renderDataView(view, page.data, { locale, color, columns: 80 }),
    )
    .join("\n");

const renderConfigDetails = (locale, color = false) =>
  configDetails()
    .map(([view, page]) =>
      renderDataView(view, page.data, { locale, color, columns: 80 }),
    )
    .join("\n");

const renderInit = (locale, color = false) =>
  initPages()
    .map((page) =>
      renderDataView("init", page.data, { locale, color, columns: 80 }),
    )
    .join("\n");

test("declarative list views preserve the legacy screen golden", async () => {
  for (const locale of ["en", "zh-CN"]) {
    const expected = await readFile(
      new URL(`fixtures/screen/lists.${locale}.txt`, import.meta.url),
      "utf8",
    );
    assert.equal(renderLists(locale), expected);
    const colored = renderLists(locale, true);
    assert.match(colored, /\u001B\[/);
    assert.equal(stripTerminalText(colored), expected);
  }
});

test("command definitions select views for pages without screen callbacks", () => {
  assert.deepEqual(commandViews, [
    "adapter.list",
    "device.list",
    "system.list",
    "run.list",
  ]);
  for (const page of pages()) assert.equal(page.screen, undefined);
  for (const [, page] of details()) assert.equal(page.screen, undefined);
  for (const [, page] of configDetails()) assert.equal(page.screen, undefined);
  for (const page of initPages()) assert.equal(page.screen, undefined);
  const outputView = (id) =>
    commandCatalogDefinition.commands.find((command) => command.id === id)
      .output.view;
  assert.equal(outputView("system.create"), "config.set");
  assert.equal(outputView("system.delete"), "config.unset");
  assert.equal(outputView("system.member.add"), "config.set");
  assert.equal(outputView("system.member.remove"), "config.set");
});

test("declarative detail views preserve labels, spacing, and colors", async () => {
  for (const locale of ["en", "zh-CN"]) {
    const expected = await readFile(
      new URL(`fixtures/screen/details.${locale}.txt`, import.meta.url),
      "utf8",
    );
    assert.equal(renderDetails(locale), expected);
    const colored = renderDetails(locale, true);
    assert.match(colored, /\u001B\[/);
    assert.equal(stripTerminalText(colored), expected);
  }
});

test("detail views omit absent optional fields from page data", () => {
  const page = deviceAddedDataPage({
    instance: "board-a",
    adapter: "esp-idf",
    path: "config.toml",
  });
  const output = renderDataView("device.add", page.data, {
    locale: "en",
    color: false,
    columns: 80,
  });
  assert.doesNotMatch(output, /Identity|Port/);
});

test("config detail views preserve JSON, origin, and scope formatting", async () => {
  for (const locale of ["en", "zh-CN"]) {
    const expected = await readFile(
      new URL(`fixtures/screen/config-details.${locale}.txt`, import.meta.url),
      "utf8",
    );
    assert.equal(renderConfigDetails(locale), expected);
    const colored = renderConfigDetails(locale, true);
    assert.match(colored, /\u001B\[/);
    assert.equal(stripTerminalText(colored), expected);
  }
});

test("init composes declarative message and detail components", async () => {
  for (const locale of ["en", "zh-CN"]) {
    const expected = await readFile(
      new URL(`fixtures/screen/init.${locale}.txt`, import.meta.url),
      "utf8",
    );
    assert.equal(renderInit(locale), expected);
    const colored = renderInit(locale, true);
    assert.match(colored, /\u001B\[/);
    assert.equal(stripTerminalText(colored), expected);
  }
  const empty = initDataPage({
    created: "config.toml",
    existing: false,
    config: {},
    project: {},
    adapters: { enabled: [] },
  });
  assert.match(
    renderDataView("init", empty.data, {
      locale: "en",
      color: false,
      columns: 80,
    }),
    /Enabled adapters None/,
  );
});

test("empty declarative tables retain their compact empty state", () => {
  const page = runListDataPage({ runs: [] });
  const output = renderDataView("run.list", page.data, {
    locale: "en",
    color: false,
    columns: 80,
  });
  assert.equal(
    output,
    "Operation records\n  No operation records are available.\n",
  );
  assert.doesNotMatch(output, /Run ID|Status|Command/);
});

test("log and artifact components preserve raw and structured list output", () => {
  const log = runLogDataPage({ runId: "run-1", log: "first\nsecond" });
  assert.equal(
    renderDataView("run.logs", log.data, {
      locale: "en",
      color: false,
      columns: 80,
    }),
    "first\nsecond\n",
  );
  const artifacts = runArtifactsDataPage({
    runId: "run-1",
    artifacts: ["firmware.bin", "report.json"],
  });
  assert.equal(
    renderDataView("run.artifacts", artifacts.data, {
      locale: "en",
      color: false,
      columns: 80,
    }),
    "Artifacts\n  firmware.bin\n  report.json\n",
  );
  assert.equal(log.screen, undefined);
  assert.equal(artifacts.screen, undefined);
});

test("lock cleanup views centralize truncation and detail layout", () => {
  const stale = {
    schema: "benchpilot.lock-clear-stale",
    version: 1,
    cleared: ["a", "b", "c", "d", "e", "f", "g"],
  };
  assert.equal(
    renderDataView("lock.clear-stale", stale, {
      locale: "en",
      color: false,
      columns: 80,
    }),
    "Cleared stale locks:\n  a\n  b\n  c\n  d\n  e\n  … and 7 stale locks in total.\n",
  );
  const clear = {
    schema: "benchpilot.lock-clear",
    version: 1,
    lock: { id: "lock-1", resource: { physicalId: "usb:123" } },
  };
  assert.equal(
    renderDataView("lock.clear", clear, {
      locale: "en",
      color: false,
      columns: 80,
    }),
    "Lock cleared\n  Lock ID     lock-1\n  Physical ID usb:123\n",
  );
});

test("run detail composes optional timing and environment blocks", () => {
  const page = runDetailDataPage({
    manifest: {
      runId: "run-001",
      status: "succeeded",
      command: "device board-a status",
      startedAt: "2026-01-01T00:00:00Z",
      endedAt: "2026-01-01T00:00:05Z",
      durationMs: 5000,
      hostname: "host",
      pid: 42,
      platform: "win32",
    },
  });
  assert.equal(
    renderDataView("run.detail", page.data, {
      locale: "en",
      color: false,
      columns: 80,
    }),
    "Operation record details\n  Run ID      run-001\n  Status      Succeeded\n  Command     device board-a status\n\nTiming\n  Started     2026-01-01T00:00:00Z\n  Ended       2026-01-01T00:00:05Z\n  Duration    5 s\n\nEnvironment\n  Host        host\n  Process     42\n  Platform    win32\n",
  );
  const sparse = runDetailDataPage({
    manifest: { runId: "run-002", status: "running" },
  });
  assert.equal(
    renderDataView("run.detail", sparse.data, {
      locale: "en",
      color: false,
      columns: 80,
    }),
    "Operation record details\n  Run ID      run-002\n  Status      Running\n",
  );
  assert.equal(page.screen, undefined);
  assert.equal(sparse.screen, undefined);
});

test("upgrade detail views replace the approved hard-coded locale output", () => {
  const check = upgradeCheckDataPage({
    packageManager: "pnpm",
    currentVersion: "0.1.0",
    latestVersion: "0.2.0",
    updateAvailable: true,
    versions: ["0.2.0"],
  });
  const result = upgradeResultDataPage({
    packageManager: "pnpm",
    previousVersion: "0.1.0",
    installedVersion: "0.2.0",
  });
  assert.equal(
    renderDataView("upgrade.check", check.data, {
      locale: "en",
      color: false,
      columns: 80,
    }),
    "BenchPilot update\n  Package manager pnpm\n  Current version 0.1.0\n  Latest version 0.2.0\n  Update status Update available\n",
  );
  assert.equal(
    renderDataView("upgrade.result", result.data, {
      locale: "zh-CN",
      color: false,
      columns: 80,
    }),
    "BenchPilot 已升级\n  包管理器    pnpm\n  版本        0.1.0 → 0.2.0\n",
  );
  assert.equal(check.screen, undefined);
  assert.equal(result.screen, undefined);
});

test("resource views compose tables and details without page callbacks", () => {
  const scan = deviceScanDataPage({
    devices: [
      { identity: "usb:1", adapter: "esp-idf", fields: { port: "COM7" } },
    ],
    adapters: [],
  });
  assert.equal(
    renderDataView("device.scan", scan.data, {
      locale: "en",
      color: false,
      columns: 80,
    }),
    "Discovered devices\n  Identity  Adapter  Port\n  usb:1     esp-idf  COM7\n",
  );
  const system = systemDetailDataPage({
    name: "pair",
    displayName: "Pair",
    labels: ["lab"],
    members: [{ device: "a", role: "primary" }, { device: "b" }],
    capabilities: [{ id: "status", summary: "Read status" }],
  });
  assert.match(
    renderDataView("system.show", system.data, {
      locale: "en",
      color: false,
      columns: 80,
    }),
    /Members\n  a {17}primary\n  b {17}-/,
  );
  const operation = {
    subject: {
      scope: "system",
      adapters: ["fixture"],
      capability: "status",
      system: { instance: "pair" },
    },
    execution: { status: "failed", durationMs: 10, dryRun: false },
    members: [
      {
        device: { instance: "a" },
        outcome: { execution: { status: "succeeded", runId: "run-a" } },
      },
      {
        device: { instance: "b" },
        outcome: { execution: { status: "failed" } },
      },
    ],
  };
  assert.match(
    renderDataView("capability.system", operation, {
      locale: "en",
      color: false,
      columns: 80,
    }),
    /Members\n  a\s+Succeeded\s+run-a\n  b\s+Failed\s+—/,
  );
  for (const page of [scan, system]) assert.equal(page.screen, undefined);
});

test("config tree and layered table preserve nested source layout", () => {
  const resolved = configResolvedDataPage({
    config: { approval: { level: "strict" }, device: { port: "COM7" } },
    origins: {
      "approval.level": { scope: "project", path: "a.toml" },
      "device.port": { scope: "local", path: "b.toml" },
    },
  });
  assert.equal(
    renderDataView("config.resolved", resolved.data, {
      locale: "en",
      color: false,
      columns: 80,
    }),
    'Resolved configuration\n  approval.level\n    Value       "strict"\n    Origin      project: a.toml\n\n  device.port\n    Value       "COM7"\n    Origin      local: b.toml\n',
  );
  const explain = configExplainDataPage({
    key: "approval.level",
    value: "strict",
    origin: { scope: "project", path: "a.toml" },
    layers: [
      { scope: "global", value: "default", path: "g.toml" },
      { scope: "project", value: "strict", path: "a.toml" },
    ],
  });
  assert.match(
    renderDataView("config.explain", explain.data, {
      locale: "en",
      color: false,
      columns: 80,
    }),
    /Configuration layers\n  Scope {11}Value {23}Path\n  global {10}"default" {19}g\.toml/,
  );
  assert.equal(resolved.screen, undefined);
  assert.equal(explain.screen, undefined);
});

test("approval and lock lists preserve status and corrupt partitions", () => {
  const approval = {
    schema: "benchpilot.approval-list",
    version: 1,
    approvals: [
      {
        id: "approval-1",
        status: "pending",
        timing: { expiresAt: "2026-01-01" },
      },
      {
        id: "approval-2",
        status: "approved",
        timing: { expiresAt: "2026-01-02" },
      },
    ],
  };
  assert.match(
    renderDataView("approval.list", approval, {
      locale: "en",
      color: false,
      columns: 80,
    }),
    /approval-1 {18}Pending {3}2026-01-01\n  approval-2 {18}Approved {2}2026-01-02/,
  );
  const lock = {
    schema: "benchpilot.lock-list",
    version: 1,
    locks: [
      {
        id: "lock-1",
        liveness: "active",
        resource: { adapter: "esp-idf", kind: "serial" },
      },
    ],
    corrupt: [{ id: "broken", entries: ["record.json", "owner"] }],
  };
  const output = renderDataView("lock.list", lock, {
    locale: "en",
    color: false,
    columns: 80,
  });
  assert.match(output, /lock-1 {28}Active {4}esp-idf \/ serial/);
  assert.match(output, /broken {28}record\.json, owner/);
  assert.doesNotMatch(
    renderDataView(
      "lock.list",
      { ...lock, corrupt: [] },
      {
        locale: "en",
        color: false,
        columns: 80,
      },
    ),
    /Corrupt lock directories/,
  );
});

test("doctor groups and messages are rendered from locale-neutral data", () => {
  const page = doctorDataPage({
    checks: [
      {
        adapter: "second",
        id: "adapter-ready",
        status: "pass",
        message: "Adapter ready fallback",
        messageKey: "doctor.adapterReady",
      },
      {
        id: "config",
        status: "pass",
        message: "Configuration fallback",
        messageKey: "doctor.configValid",
      },
      {
        adapter: "first",
        id: "plain",
        status: "warn",
        message: "Plain adapter warning",
      },
      {
        adapter: "second",
        id: "unknown-key",
        status: "fail",
        message: "Unknown key fallback",
        messageKey: "doctor.unknownKey",
      },
    ],
  });
  const calls = [];
  const output = renderDataView("doctor", page.data, {
    locale: "zh-CN",
    color: false,
    columns: 80,
    messageResolver: (input) => {
      calls.push(input);
      return input.key === "doctor.adapterReady" ? "适配器已就绪" : undefined;
    },
  });

  assert.match(output, /^本地环境\n  检查项\s+结果\s+详情/);
  assert.match(output, /config\s+通过\s+TOML 和配置架构有效/);
  assert.ok(output.indexOf("适配器：second") < output.indexOf("适配器：first"));
  assert.match(output, /adapter-ready {2}通过 {4}适配器已就绪/);
  assert.match(output, /unknown-key {4}失败 {4}Unknown key fallback/);
  const resultColumns = output
    .split("\n")
    .filter((line) => /^(  config|  adapter-ready|  unknown-key)/.test(line))
    .map((line) => line.search(/通过|失败/));
  assert.equal(resultColumns.length, 3);
  assert.equal(new Set(resultColumns).size, 1);
  assert.deepEqual(
    calls.map(({ adapter, key }) => ({ adapter, key })),
    [
      { adapter: "second", key: "doctor.adapterReady" },
      { adapter: "second", key: "doctor.unknownKey" },
    ],
  );
  assert.equal(page.data.checks[0].message, "Adapter ready fallback");
  assert.equal(page.data.checks[0].messageKey, "doctor.adapterReady");
  assert.equal(page.screen, undefined);
});

test("doctor keeps the local group header when only adapters have checks", () => {
  const page = doctorDataPage({
    checks: [
      { adapter: "demo", id: "ready", status: "pass", message: "Ready" },
    ],
  });
  assert.equal(
    renderDataView("doctor", page.data, {
      locale: "en",
      color: false,
      columns: 80,
    }),
    "Local environment\n  Check         Result  Details\n\nAdapter: demo\n  Check         Result  Details\n  ready         Pass    Ready\n",
  );
});

test("adapter doctor uses the shared table and external message resolver", () => {
  const page = adapterDoctorDataPage("demo", {
    checks: [
      {
        id: "tool",
        status: "pass",
        message: "Tool fallback",
        messageKey: "doctor.toolReady",
        messageValues: { tool: "probe" },
      },
    ],
  });
  const output = renderDataView("adapter.doctor", page.data, {
    locale: "zh-CN",
    color: false,
    columns: 80,
    messageResolver: ({ adapter, key, values }) =>
      adapter === "demo" &&
      key === "doctor.toolReady" &&
      values.tool === "probe"
        ? "probe 已就绪"
        : undefined,
  });
  assert.equal(
    output,
    "全局适配器配置\n  尚未持久化全局适配器配置。\n\n适配器诊断\n  检查项        结果    详情\n  tool          通过    probe 已就绪\n",
  );
  assert.equal(page.data.checks[0].adapter, "demo");
  assert.equal(page.data.checks[0].message, "Tool fallback");
  assert.equal(page.screen, undefined);
});

test("adapter doctor renders global configuration as a key-value table", () => {
  const page = adapterDoctorDataPage("esp-idf", {
    configuration: {
      python_path: "C:/Espressif/python.exe",
      flash_baud: 460800,
    },
    checks: [
      {
        id: "esp-idf-environment-inherit",
        status: "pass",
        message: "Environment resolved.",
      },
    ],
  });
  const output = renderDataView("adapter.doctor", page.data, {
    locale: "zh-CN",
    color: false,
    columns: 100,
  });
  const valueLine = output
    .split("\n")
    .find((line) => line.includes("C:/Espressif/python.exe"));
  const resultLine = output
    .split("\n")
    .find((line) => line.includes("esp-idf-environment-inherit"));
  assert.ok(valueLine);
  assert.ok(resultLine);
  assert.equal(
    valueLine.indexOf("C:/Espressif/python.exe"),
    resultLine.indexOf("通过"),
  );
});

test("adapter discovery renders persisted configuration values", () => {
  const page = adapterConfigurationDataPage({
    adapter: "esp-idf",
    path: "C:/Users/example/.benchpilot/config.toml",
    changed: true,
    config: {
      python_path: "C:/Espressif/python.exe",
      idf_path: "D:/Program/esp/esp-idf",
    },
    tools: [],
  });
  assert.equal(
    renderDataView("adapter.discover", page.data, {
      locale: "zh-CN",
      color: false,
      columns: 120,
    }),
    "已发现的工具\n  适配器未声明工具。\n\n全局适配器配置\n  python_path\n    值                C:/Espressif/python.exe\n\n  idf_path\n    值                D:/Program/esp/esp-idf\n",
  );
});

test("approval detail composes binding, device, timing, and claim sections", () => {
  const base = {
    schema: "benchpilot.approval",
    version: 1,
    id: "approval-1",
    digest: "digest",
    binding: {
      command: "device.demo.deploy",
      project: "demo",
      device: {
        adapter: "demo",
        instance: "board",
        physicalId: "usb:1",
      },
      input: { profile: "release" },
    },
    createdAt: "2026-01-01",
    expiresAt: "2026-01-02",
    status: "pending",
  };
  const page = approvalDetailDataPage(base, {
    projectId: "demo",
    projectName: "Demo",
  });
  assert.equal(
    renderDataView("approval.inspect", page.data, {
      locale: "en",
      color: false,
      columns: 80,
      presentation: page.presentation,
    }),
    'Approval details\n  Approval ID approval-1\n  Status      Pending\n\nOperation binding\n  Command     Device operation: deploy\n  Project     Demo\n  Input       {"profile":"release"}\n\nDevice\n  Adapter     demo\n  Instance    board\n  Physical ID usb:1\n\nTiming\n  Created     2026-01-01\n  Expires     2026-01-02\n',
  );
  assert.equal(page.screen, undefined);
  assert.equal("presentation" in page.data, false);

  const claimed = approvalDetailDataPage({
    ...base,
    status: "claimed",
    changedAt: "change",
    releasedAt: "release",
    consumedAt: "consume",
    claimedBy: "worker",
    claimedAt: "claim",
    claimHeartbeatAt: "beat",
    claimExpiresAt: "claim-expiry",
    binding: {
      ...base.binding,
      presentation: {
        command: { capability: "deploy", summary: "Custom" },
        project: { name: "Stored" },
      },
    },
  });
  assert.equal(
    renderDataView("approval.inspect", claimed.data, {
      locale: "en",
      color: false,
      columns: 80,
    }),
    'Approval details\n  Approval ID approval-1\n  Status      Claimed\n\nOperation binding\n  Command     Deploy\n  Project     Stored\n  Input       {"profile":"release"}\n\nDevice\n  Adapter     demo\n  Instance    board\n  Physical ID usb:1\n\nTiming\n  Created     2026-01-01\n  Expires     2026-01-02\n  Changed     change\n  Released    release\n  Consumed    consume\n\nClaim\n  Claimed by  worker\n  Claimed at  claim\n  Last heartbeat beat\n  Claim expires claim-expiry\n',
  );
});

test("language commands use shared table and detail components", () => {
  const languages = [
    { value: "en", label: "English" },
    { value: "zh-CN", label: "简体中文" },
  ];
  const list = languageListDataPage(languages);
  assert.equal(
    renderDataView("language.list", list.data, {
      locale: "en",
      color: false,
      columns: 80,
    }),
    "Supported CLI languages\n  Locale    Language\n  en        English\n  zh-CN     简体中文\n",
  );
  const current = languageDataPage("en", languages);
  assert.equal(
    renderDataView("language.get", current.data, {
      locale: "en",
      color: false,
      columns: 80,
    }),
    "Current CLI language\n  Locale      en\n  Language    English\n",
  );
  const updated = languageDataPage("zh-CN", languages);
  assert.equal(
    renderDataView("language.set", updated.data, {
      locale: "zh-CN",
      color: false,
      columns: 80,
    }),
    "CLI 语言已更新\n  区域设置    zh-CN\n  语言        简体中文\n",
  );
  assert.deepEqual(list.jsonl, [
    { key: "languages.en", value: { locale: "en", name: "English" } },
    {
      key: "languages.zh-CN",
      value: { locale: "zh-CN", name: "简体中文" },
    },
  ]);
});

test("run prune uses the shared list component and itemized snapshots", () => {
  const page = runPruneDataPage({ removed: ["run-1", "run-2"] });
  assert.equal(
    renderDataView("run.prune", page.data, {
      locale: "en",
      color: false,
      columns: 80,
    }),
    "Removed operation records\n  run-1\n  run-2\n",
  );
  assert.equal(
    renderDataView("run.prune", runPruneDataPage({ removed: [] }).data, {
      locale: "zh-CN",
      color: false,
      columns: 80,
    }),
    "已删除的操作记录\n  没有删除任何操作记录。\n",
  );
  assert.deepEqual(page.jsonl, [
    { key: "removed.run-1", value: { runId: "run-1" } },
    { key: "removed.run-2", value: { runId: "run-2" } },
  ]);
  const outputView = (id) =>
    commandCatalogDefinition.commands.find((command) => command.id === id)
      .output.view;
  assert.equal(outputView("language.list"), "language.list");
  assert.equal(outputView("language.get"), "language.get");
  assert.equal(outputView("language.set"), "language.set");
  assert.equal(outputView("run.prune"), "run.prune");
});

test("byte-size formatter retains an exact byte count beside the scaled value", () => {
  assert.equal(
    formatDataCell({
      formatter: "byte-size",
      row: { bytes: 1489732 },
      field: "bytes",
      locale: "en",
    }).text,
    "1.42 MiB (1,489,732 B)",
  );
  assert.equal(
    formatDataCell({
      formatter: "byte-size",
      row: { bytes: 512 },
      field: "bytes",
      locale: "zh-CN",
    }).text,
    "512 B",
  );
});

test("duration formatter scales units for the active locale", () => {
  assert.equal(
    formatDataCell({
      formatter: "duration-ms",
      row: { duration: 140199 },
      field: "duration",
      locale: "zh-CN",
    }).text,
    "2 分 20.2 秒",
  );
  assert.equal(
    formatDataCell({
      formatter: "duration-ms",
      row: { duration: 3_723_000 },
      field: "duration",
      locale: "en",
    }).text,
    "1h 2m 3s",
  );
});
