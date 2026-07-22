import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  AGENT_MARKER_CONTRACT_VERSION,
  detectAgent,
} from "../dist/cli/agent/detector.js";
import { interactionDecision } from "../dist/cli/interaction/policy.js";
import {
  InteractionBackError,
  InteractionCancelledError,
  InteractionExitedError,
  InteractionSession,
  INTERACTION_BACK,
  INTERACTION_EXIT,
  compactPromptAnswer,
  interactionShortcut,
  menuDivider,
} from "../dist/cli/interaction/prompter.js";
import {
  renderInteractiveHomeHeader,
  rootMenuChoices,
} from "../dist/cli/presentation/root-help.js";
import { commandRoots } from "../dist/application/commands/catalog.js";
import { commandCatalogDefinition } from "../dist/application/commands/definitions.js";
import { HelpDocumentService } from "../dist/application/commands/help.js";
import { projectHelpDocument } from "../dist/cli/help/projector.js";
import { humanErrorMessage } from "../dist/cli/output/failure.js";
import { renderFailure } from "../dist/cli/output/failure.js";
import { handleDeviceCommand } from "../dist/cli/commands/device.js";
import { t } from "../dist/i18n/index.js";
import { shouldShowWordmark } from "../dist/cli/presentation/theme.js";
import { renderVersion } from "../dist/cli/presentation/version.js";
import { handleRuntimeCommand } from "../dist/cli/commands/runtime.js";
import {
  configurationCatalog,
  configurationMenuChoices,
  configurationValueMenuChoices,
} from "../dist/cli/config-catalog.js";

const scriptedDriver = (...answers) => {
  let position = 0;
  const next = async () => answers[position++];
  return { choose: next, value: next };
};

test("agent detection only accepts fixed environment and file markers", () => {
  assert.equal(AGENT_MARKER_CONTRACT_VERSION, 1);
  assert.equal(
    detectAgent({ env: { SSH_CONNECTION: "host" }, fileExists: () => false }),
    undefined,
  );
  assert.equal(
    detectAgent({ env: { CI: "1" }, fileExists: () => false }),
    undefined,
  );
  assert.equal(
    detectAgent({
      env: { CLAUDECODE: "1", CODEX_THREAD_ID: "thread" },
      fileExists: () => false,
    }).name,
    "Claude Code",
  );
  assert.equal(
    detectAgent({ env: { CODEX_THREAD_ID: "" }, fileExists: () => false }),
    undefined,
  );
  assert.equal(
    detectAgent({
      env: { AI_AGENT: "generic", AGENT: "goose" },
      fileExists: () => false,
    }).name,
    "Goose",
  );
  assert.equal(
    detectAgent({ env: { AGENT: "custom" }, fileExists: () => false }).name,
    "AI agent",
  );
  assert.equal(
    detectAgent({ env: { CODEX_THREAD_ID: "abc" }, fileExists: () => false })
      .kind,
    "agent",
  );
  assert.equal(
    detectAgent({
      env: { REPLIT_SESSION: "agent-123" },
      fileExists: () => false,
    }).name,
    "Replit Agent",
  );
  assert.equal(
    detectAgent({ env: {}, fileExists: (file) => file === "/opt/.devin" }).name,
    "Devin",
  );
});

test("interaction policy keeps agent identity separate from terminal availability", () => {
  assert.equal(
    interactionDecision({ stdinIsTTY: false, stdoutIsTTY: false }).reason,
    "terminal-unavailable",
  );
  assert.equal(
    interactionDecision({ json: true, stdinIsTTY: true, stdoutIsTTY: true })
      .reason,
    "machine-output",
  );
  assert.deepEqual(
    interactionDecision({
      stdinIsTTY: true,
      stdoutIsTTY: true,
      // CI is not a caller-identity signal.
      ci: true,
    }),
    { allowed: true },
  );
  assert.equal(
    interactionDecision({
      agent: { kind: "agent", name: "Agent", marker: "AI_AGENT" },
      stdinIsTTY: true,
      stdoutIsTTY: true,
    }).reason,
    "agent",
  );
  const agentMode = interactionDecision({
    agentMode: true,
    stdinIsTTY: true,
    stdoutIsTTY: true,
  });
  assert.equal(agentMode.reason, "agent");
  if (!agentMode.allowed) assert.equal(agentMode.agent.marker, "--agent");
});

test("interactive shortcut keys do not overlap with searchable text input", () => {
  assert.equal(interactionShortcut("q"), undefined);
  assert.equal(interactionShortcut("query"), undefined);
  assert.equal(interactionShortcut("\u001b"), INTERACTION_BACK);
  assert.equal(interactionShortcut("\u001b[A"), undefined);
  assert.equal(interactionShortcut("\u0018"), INTERACTION_EXIT);
});

test("interactive answers use compact spacing after selection", () => {
  assert.equal(
    compactPromptAnswer("lock      查看和管理物理资源锁"),
    "lock 查看和管理物理资源锁",
  );
});

test("interactive lock clear asks for confirmation before clearing a quarantined lock", async () => {
  const calls = [];
  const confirmations = [];
  let output = "";
  const originalWrite = process.stdout.write;
  process.stdout.write = (value) => {
    output += String(value);
    return true;
  };
  try {
    const handled = await handleRuntimeCommand({
      flags: {},
      intent: {
        commandId: "lock.clear",
        handlerId: "lock.clear",
        path: ["lock", "quarantined-lock", "clear"],
        input: { lock: "quarantined-lock" },
        options: {},
        globals: {},
      },
      dispatcher: { dispatch: async () => assert.fail("clear was cancelled") },
      locale: "en",
      color: false,
      runtimeCommands: {
        execute: async (request) => {
          calls.push(request);
          return {
            data: {
              lockId: "quarantined-lock",
              state: "quarantined",
              liveness: "active",
              identity: {
                adapter: "fixture",
                kind: "device",
                physicalId: "fixture-device",
              },
              hostname: "fixture-host",
              pid: 1234,
              command: "fixture-command",
              acquiredAt: "2026-01-01T00:00:00.000Z",
              heartbeatAt: "2026-01-01T00:00:00.000Z",
              expiresAt: "2026-01-01T00:00:30.000Z",
            },
          };
        },
      },
      confirmApproval: async () => false,
      confirmLockClear: async (input) => {
        confirmations.push(input);
        return false;
      },
    });
    assert.equal(handled, true);
  } finally {
    process.stdout.write = originalWrite;
  }
  assert.deepEqual(confirmations, [
    {
      lockId: "quarantined-lock",
      state: "quarantined",
      liveness: "active",
    },
  ]);
  assert.deepEqual(calls, [{ action: "lock.show", id: "quarantined-lock" }]);
  assert.match(output, /^Lock details/m);
  assert.match(output, /^  Lock ID     quarantined-lock$/m);
  assert.doesNotMatch(output, /Lock cleared/);
});

test("incomplete device resources delegate to definition-driven help", async () => {
  const rendered = [];
  assert.equal(
    await handleDeviceCommand({
      parts: ["device", "board"],
      flags: {},
      rawOptions: [],
      devices: {},
      catalog: {},
      localizeCapabilities: (_adapterId, capabilities) => [...capabilities],
      renderHelp: async (path, includeAll = false) => {
        rendered.push({ path: [...path], includeAll });
      },
    }),
    true,
  );
  assert.deepEqual(rendered, [{ path: ["device", "board"], includeAll: true }]);
});

test("interactive device execution confirms approval before running", async () => {
  const originalWrite = process.stdout.write;
  const flags = {};
  const calls = [];
  process.stdout.write = () => true;
  try {
    const handled = await handleDeviceCommand({
      parts: ["device", "fixture", "flash"],
      flags,
      rawOptions: [],
      locale: "en",
      localizeCapabilities: (_adapterId, capabilities) => [...capabilities],
      catalog: { executable: async () => ({}) },
      devices: {
        describe: async () => ({ capabilities: [] }),
        capability: async () => ({
          adapter: { id: "fixture" },
          capability: {
            id: "flash",
            summary: "Flash firmware",
            options: [],
            safety: { mode: "destructive" },
          },
        }),
        executeDetailed: async (input) => {
          calls.push({ type: "execute", input });
          return {
            status: "succeeded",
            subject: {
              adapter: "fixture",
              capability: "flash",
              device: { instance: "fixture", physicalId: "fixture" },
            },
            execution: {
              status: "succeeded",
              startedAt: "2026-07-20T00:00:00.000Z",
              endedAt: "2026-07-20T00:00:00.000Z",
              durationMs: 0,
              dryRun: false,
            },
            artifacts: [],
            result: {},
            cleanupErrors: [],
            lockFinalStatus: "not-required",
          };
        },
      },
      output: { write: () => true },
      confirmApproval: async () => {
        calls.push({ type: "approval" });
        return true;
      },
      requiresApproval: () => true,
    });
    assert.equal(handled, true);
  } finally {
    process.stdout.write = originalWrite;
  }
  assert.deepEqual(calls, [
    { type: "approval" },
    {
      type: "execute",
      input: {
        device: "fixture",
        capability: "flash",
        capabilityInput: {},
        executionMode: "interactive",
      },
    },
  ]);
});

test("screen catalogs provide localized text and leave machine protocol out of translation", () => {
  assert.equal(t("zh-CN", "init.done"), "BenchPilot 项目已初始化。");
  assert.equal(t("zh-CN", "menu.action.set"), "写入配置");
  assert.equal(t("zh-CN", "menu.runs.keep"), "保留最新操作记录");
});

test("interactive home flattens commands under non-selectable categories", async () => {
  const document = await new HelpDocumentService(commandCatalogDefinition, {
    values: async () => [],
  }).document([]);
  const choices = rootMenuChoices(projectHelpDocument(document, "zh-CN"));
  assert.deepEqual(
    choices
      .filter((choice) => "separator" in choice)
      .map((choice) => choice.separator),
    ["开始使用", "环境与接入", "资源与编排", "审计与安全", "帮助"],
  );
  assert.deepEqual(
    choices.filter((choice) => "value" in choice).map((choice) => choice.value),
    [
      "init",
      "doctor",
      "language",
      "config",
      "adapter",
      "device",
      "system",
      "run",
      "approval",
      "lock",
      "upgrade",
      "help",
      "version",
    ],
  );
});

test("interactive sessions append navigation and distinguish back from exit", async () => {
  const requests = [];
  const session = new InteractionSession("en", {
    choose: async (request) => {
      requests.push(request);
      return requests.length === 1 ? "list" : INTERACTION_BACK;
    },
    value: async () => undefined,
  });
  await session.choose([{ value: "list" }], {
    nextBackPath: ["home"],
  });
  await assert.rejects(session.choose([{ value: "show" }]), (error) => {
    assert.ok(error instanceof InteractionBackError);
    assert.deepEqual(error.path, ["home"]);
    assert.deepEqual(error.remainingPaths, []);
    return true;
  });
  assert.deepEqual(
    requests[0].choices.slice(-2).map((choice) => choice.value),
    [undefined, INTERACTION_EXIT],
  );
  assert.equal(requests[0].choices.at(-2).separator, menuDivider());
  assert.equal(requests[1].choices.at(-3).separator, menuDivider());
  assert.equal(requests[1].choices.at(-2).description, "Esc Back\n");
  assert.equal(requests[1].choices.at(-1).description, "Ctrl+X Exit\n");
  assert.deepEqual(
    requests[1].choices.slice(-3).map((choice) => choice.value),
    [undefined, INTERACTION_BACK, INTERACTION_EXIT],
  );
  assert.equal(requests[0].pageSize, 100);

  const exiting = new InteractionSession("en", {
    choose: async () => INTERACTION_EXIT,
    value: async () => undefined,
  });
  await assert.rejects(
    exiting.choose([{ value: "list" }]),
    (error) => error instanceof InteractionExitedError,
  );
});

test("first-level menus enable the native double-Esc exit confirmation", async () => {
  const requests = [];
  const session = new InteractionSession("zh-CN", {
    choose: async (request) => {
      requests.push(request);
      return "lock";
    },
    value: async () => undefined,
  });
  await session.choose([{ value: "lock" }], {
    commandPath: ["lock"],
    ignoreInitialEscape: true,
  });
  assert.equal(requests[0].exitConfirmation, true);
  assert.equal(requests[0].ignoreInitialEscape, true);
});

test("interactive sessions retain the full back stack across a resumed menu", async () => {
  const session = new InteractionSession(
    "en",
    scriptedDriver("lock", "visible-lock", INTERACTION_BACK),
  );
  await session.choose([{ value: "lock" }], { nextBackPath: ["home"] });
  await session.choose([{ value: "visible-lock" }], {
    nextBackPath: ["lock"],
  });
  let firstBack;
  await assert.rejects(session.choose([{ value: "show" }]), (error) => {
    assert.ok(error instanceof InteractionBackError);
    firstBack = error;
    return true;
  });
  assert.deepEqual(firstBack.path, ["lock"]);
  assert.deepEqual(firstBack.remainingPaths, [["home"]]);

  const resumed = new InteractionSession(
    "en",
    scriptedDriver(INTERACTION_BACK),
    false,
    firstBack.remainingPaths,
  );
  await assert.rejects(resumed.choose([{ value: "visible-lock" }]), (error) => {
    assert.ok(error instanceof InteractionBackError);
    assert.deepEqual(error.path, ["home"]);
    assert.deepEqual(error.remainingPaths, []);
    return true;
  });
});

test("interactive home header keeps the human root identity above the menu", () => {
  const header = renderInteractiveHomeHeader("zh-CN", false, true);
  assert.match(header, /面向 Agent 的设备生命周期 CLI/);
  assert.doesNotMatch(header, /操作指引/);
  assert.doesNotMatch(header, /输入以筛选命令/);
  assert.match(header, /___/);
});

test("wordmarks are limited to human terminal screens", () => {
  assert.equal(shouldShowWordmark(true), true);
  assert.equal(shouldShowWordmark(false), false);
  assert.match(
    renderVersion({ cliVersion: "0.0.0", nodeVersion: "v24.0.0" }, false, true),
    /________/,
  );
  assert.match(
    renderVersion(
      { cliVersion: "0.0.0", nodeVersion: "v24.0.0" },
      false,
      true,
      80,
    ),
    /\/ __\\/,
  );
  assert.doesNotMatch(
    renderVersion(
      { cliVersion: "0.0.0", nodeVersion: "v24.0.0" },
      false,
      false,
    ),
    /________/,
  );
});

test("interactive sessions keep one conversation alive for sequential choices", async () => {
  const session = new InteractionSession(
    "en",
    scriptedDriver("set", "project.name"),
  );
  try {
    assert.equal(
      await session.choose([{ value: "get" }, { value: "set" }]),
      "set",
    );
    assert.equal(await session.value("key"), "project.name");
  } finally {
    session.close();
  }
});

test("configuration picker uses the fixed localized configuration catalog", () => {
  assert.deepEqual(
    configurationCatalog.map((entry) => entry.key),
    [
      "project.id",
      "project.name",
      "defaults.timeout",
      "adapters.enabled",
      "approval.level",
      "cli.locale",
    ],
  );
  const choices = configurationMenuChoices("zh-CN", false);
  assert.equal(choices.length, configurationCatalog.length);
  const projectIdChoice = choices.find(
    (choice) => choice.value === "project.id",
  );
  assert.match(projectIdChoice.label, /项目 ID/);
  assert.match(projectIdChoice.label, /稳定唯一标识/);
  assert.equal(
    configurationCatalog.find((entry) => entry.key === "approval.level").editor,
    "select",
  );
  assert.deepEqual(
    configurationCatalog
      .find((entry) => entry.key === "approval.level")
      .choices.map((choice) => choice.value),
    ["strict", "default", "bypass"],
  );
  const approvalEntry = configurationCatalog.find(
    (entry) => entry.key === "approval.level",
  );
  assert.ok(approvalEntry);
  const approvalValues = configurationValueMenuChoices(
    approvalEntry,
    "zh-CN",
    false,
  );
  const descriptionOffsets = [
    [approvalValues[0].label, "对所有声明为非普通安全等级"],
    [approvalValues[1].label, "仅对不可逆的破坏性操作"],
    [approvalValues[2].label, "自动化操作不再"],
  ].map(([label, description]) =>
    [...label.slice(0, label.indexOf(description))].reduce(
      (width, character) => width + (character.codePointAt(0) > 0xff ? 2 : 1),
      0,
    ),
  );
  assert.equal(new Set(descriptionOffsets).size, 1);
  assert.equal(
    configurationCatalog.find((entry) => entry.key === "adapters.enabled")
      .editor,
    "multi-select",
  );
  assert.deepEqual(
    configurationCatalog.find((entry) => entry.key === "adapters.enabled")
      .scopes,
    ["project"],
  );
  assert.deepEqual(
    configurationCatalog.find((entry) => entry.key === "approval.level").scopes,
    ["local", "global"],
  );
});

test("interactive session treats EOF as cancellation", async () => {
  const session = new InteractionSession("en", scriptedDriver(undefined));
  try {
    const selection = session.choose([{ value: "list" }]);
    await assert.rejects(
      selection,
      (error) => error instanceof InteractionCancelledError,
    );
  } finally {
    session.close();
  }
});

test("interactive session translates Inquirer exits into cancellation", async () => {
  const session = new InteractionSession("en", {
    choose: async () => {
      const error = new Error("interrupted");
      error.name = "ExitPromptError";
      throw error;
    },
    value: async () => undefined,
  });
  await assert.rejects(
    session.choose([{ value: "list" }]),
    (error) => error instanceof InteractionCancelledError,
  );
});

test("interactive sessions pass searchable prompt options to their driver", async () => {
  let received;
  const session = new InteractionSession("en", {
    choose: async (request) => {
      received = request;
      return "init";
    },
    value: async () => undefined,
  });
  await session.choose([{ value: "init" }], {
    pageSize: 100,
    commandPath: [],
  });
  assert.equal(received.pageSize, 100);
  assert.equal(received.searchable, true);
  assert.equal(received.choices[0].description, "$ benchpilot init\n");
});

test("interactive exit uses the localized error color on human terminals", async () => {
  let received;
  const session = new InteractionSession(
    "zh-CN",
    {
      choose: async (request) => {
        received = request;
        return "list";
      },
      value: async () => undefined,
    },
    true,
  );
  await session.choose([{ value: "list" }]);
  const exit = received.choices.at(-1);
  assert.equal(exit.value, INTERACTION_EXIT);
  assert.match(exit.label, /\u001B\[38;5;203m退出/);
});

test("presenter keeps machine failures on stdout and human failures on stderr", () => {
  const stdout = [];
  const stderr = [];
  const sink = {
    stdout: { write: (value) => stdout.push(value) },
    stderr: { write: (value) => stderr.push(value) },
  };
  const command = { id: "fixture", path: ["fixture"] };
  const result = {
    schema: "benchpilot.result",
    version: 3,
    ok: false,
    command,
    kind: "data",
    error: { kind: "USAGE_ERROR", diagnosticId: "core.usage-error" },
    meta: {
      startedAt: "2026-01-01T00:00:00.000Z",
      endedAt: "2026-01-01T00:00:00.000Z",
      durationMs: 0,
    },
  };
  renderFailure({
    result,
    command,
    flags: { json: true },
    terminalEmitted: false,
    humanMessage: "USAGE_ERROR: invalid input",
    sink,
  });
  assert.match(stdout.join(""), /USAGE_ERROR/);
  assert.equal(stderr.join(""), "");
  renderFailure({
    result,
    command,
    flags: {},
    terminalEmitted: false,
    humanMessage: "USAGE_ERROR: invalid input",
    sink,
  });
  assert.match(stderr.join(""), /invalid input/);
});

test("presenter localizes human error categories without changing machine kinds", () => {
  assert.equal(
    humanErrorMessage("zh-CN", "DEVICE_NOT_FOUND", "Device not found: demo"),
    "设备错误：找不到指定设备。",
  );
  assert.equal(
    humanErrorMessage("en", "DEVICE_NOT_FOUND", "Device not found: demo"),
    "Device error: The requested device was not found.",
  );
  assert.equal(
    humanErrorMessage(
      "zh-CN",
      "PROJECT_NOT_FOUND",
      "A BenchPilot project is required for project state commands.",
    ),
    "配置错误：项目状态命令需要在 BenchPilot 项目中执行。",
  );
  assert.equal(
    humanErrorMessage(
      "zh-CN",
      "DANGEROUS_CONFIRMATION_REQUIRED",
      "This operation requires --dangerously-info.",
    ),
    "安全确认错误：该操作缺少所需的显式安全确认选项。",
  );
});

test("command catalog is the CLI root-menu source", () => {
  assert.deepEqual(
    commandRoots.map((command) => command.path[0]),
    [
      "init",
      "doctor",
      "language",
      "config",
      "adapter",
      "device",
      "system",
      "run",
      "lock",
      "approval",
      "help",
      "home",
      "version",
      "upgrade",
    ],
  );
});

test("only the presenter owns CLI terminal writes", async () => {
  const root = join(process.cwd(), "src", "cli");
  const files = (await readdir(root, { recursive: true })).filter((file) =>
    file.endsWith(".ts"),
  );
  for (const file of files) {
    if (file === "output\\failure.ts") continue;
    const source = await readFile(join(root, file), "utf8");
    assert.doesNotMatch(source, /(?:process\.)?(?:stdout|stderr)\.write/);
    assert.doesNotMatch(source, /createInterface|node:readline/);
  }
});

test("only the CLI presentation layer imports screen localization", async () => {
  const roots = [
    join(process.cwd(), "src", "application"),
    join(process.cwd(), "src", "core"),
    join(process.cwd(), "src", "adapters"),
  ];
  for (const root of roots) {
    const files = (await readdir(root, { recursive: true })).filter((file) =>
      file.endsWith(".ts"),
    );
    for (const file of files) {
      const source = await readFile(join(root, file), "utf8");
      assert.doesNotMatch(source, /(?:from|import)\s+["'][^"']*i18n/);
    }
  }
});

test("core does not import TOML parsing", async () => {
  const root = join(process.cwd(), "src", "core");
  const files = (await readdir(root, { recursive: true })).filter((file) =>
    file.endsWith(".ts"),
  );
  for (const file of files) {
    const source = await readFile(join(root, file), "utf8");
    assert.doesNotMatch(source, /@iarna\/toml/);
  }
});
