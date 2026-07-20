import assert from "node:assert/strict";
import test from "node:test";
import { createApplicationCommandDispatcher } from "../dist/application/commands/application-dispatcher.js";

const intent = (commandId, handlerId, input = {}, options = {}) => ({
  commandId,
  handlerId,
  path: commandId.split("."),
  input,
  options,
  globals: {},
});

test("application command dispatcher maps intents to neutral use cases", async () => {
  const calls = [];
  const dispatcher = createApplicationCommandDispatcher({
    configuration: {
      async execute(input) {
        calls.push(["config", input]);
        return { kind: "config.get", data: { key: input.key, value: "Demo" } };
      },
    },
    runtime: {
      async execute(input) {
        calls.push(["runtime", input]);
        return { kind: `runtime.${input.action}`, data: { runs: [] } };
      },
    },
    queries: {
      listAdapters() {
        return { adapters: [] };
      },
    },
    resolvedConfig: { value: { cli: { locale: "zh-CN" } } },
  });

  assert.deepEqual(
    await dispatcher.dispatch(
      intent(
        "config.get",
        "config.get",
        { key: "project.name" },
        { "show-origin": true },
      ),
    ),
    {
      commandId: "config.get",
      kind: "config.get",
      data: { key: "project.name", value: "Demo" },
    },
  );
  await dispatcher.dispatch(
    intent("run.list", "run.list", {}, { status: "failed", limit: "10" }),
  );
  assert.deepEqual(
    await dispatcher.dispatch(intent("language.get", "language.get")),
    {
      commandId: "language.get",
      kind: "language.get",
      data: {
        schema: "benchpilot.language",
        version: 1,
        language: { locale: "zh-CN", name: "简体中文" },
      },
    },
  );
  assert.deepEqual(
    await dispatcher.dispatch(
      intent("language.set", "language.set", { locale: "en" }),
    ),
    {
      commandId: "language.set",
      kind: "language.set",
      data: {
        schema: "benchpilot.language",
        version: 1,
        language: { locale: "en", name: "English" },
      },
    },
  );
  assert.deepEqual(calls, [
    [
      "config",
      {
        action: "get",
        key: "project.name",
        value: undefined,
        scopes: [],
        showOrigin: true,
        enforceCatalog: true,
      },
    ],
    ["runtime", { action: "runs.list", status: "failed", limit: "10" }],
    [
      "config",
      {
        action: "set",
        key: "cli.locale",
        value: "en",
        scopes: ["global"],
        showOrigin: false,
      },
    ],
  ]);
});
