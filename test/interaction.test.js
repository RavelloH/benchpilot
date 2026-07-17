import test from "node:test";
import assert from "node:assert/strict";
import prompts from "prompts";
import {
  AGENT_MARKER_CONTRACT_VERSION,
  detectAgent,
} from "../dist/cli/agent/detector.js";
import { interactionDecision } from "../dist/cli/interaction/policy.js";
import {
  InteractionCancelledError,
  InteractionSession,
} from "../dist/cli/interaction/prompter.js";
import { fullHelp, humanFull } from "../dist/cli/help-renderer.js";
import { commandRoots } from "../dist/application/commands/catalog.js";
import { writeFailure } from "../dist/cli/output-renderer.js";
import { assertCatalogCompleteness, t } from "../dist/i18n/index.js";

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
});

test("screen catalogs are complete and leave machine protocol out of translation", () => {
  assert.doesNotThrow(assertCatalogCompleteness);
  assert.equal(t("zh-CN", "init.done"), "BenchPilot 项目已初始化。");
  assert.match(
    humanFull(["config"], "zh-CN"),
    /读取、解释、校验并安全编辑配置/,
  );
  assert.match(fullHelp(["config"]).summary, /Read, explain/);
});

test("interactive sessions keep one conversation alive for sequential choices", async () => {
  prompts.inject(["set", "project.name"]);
  const session = new InteractionSession("en");
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

test("interactive session treats EOF as cancellation", async () => {
  prompts.inject([undefined]);
  const session = new InteractionSession("en");
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

test("presenter keeps machine failures on stdout and human failures on stderr", () => {
  const stdout = [];
  const stderr = [];
  const sink = {
    stdout: { write: (value) => stdout.push(value) },
    stderr: { write: (value) => stderr.push(value) },
  };
  writeFailure({
    result: { ok: false, kind: "USAGE_ERROR" },
    flags: { json: true },
    isOperation: false,
    terminalEmitted: false,
    humanMessage: "USAGE_ERROR: invalid input",
    sink,
  });
  assert.match(stdout.join(""), /USAGE_ERROR/);
  assert.equal(stderr.join(""), "");
  writeFailure({
    result: { ok: false, kind: "USAGE_ERROR" },
    flags: {},
    isOperation: false,
    terminalEmitted: false,
    humanMessage: "USAGE_ERROR: invalid input",
    sink,
  });
  assert.match(stderr.join(""), /invalid input/);
});

test("command catalog is the CLI root-menu source", () => {
  assert.deepEqual(
    commandRoots.map((command) => command.path[0]),
    [
      "init",
      "doctor",
      "config",
      "adapters",
      "adapter",
      "devices",
      "device",
      "systems",
      "system",
      "runs",
      "run",
      "locks",
      "lock",
      "approvals",
      "approval",
      "help",
    ],
  );
});
