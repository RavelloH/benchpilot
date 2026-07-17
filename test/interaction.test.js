import test from "node:test";
import assert from "node:assert/strict";
import { detectAgent } from "../dist/cli/agent/detector.js";
import { interactionDecision } from "../dist/cli/interaction/policy.js";
import { assertCatalogCompleteness, t } from "../dist/i18n/index.js";

test("agent detection only accepts fixed environment and file markers", () => {
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
});
