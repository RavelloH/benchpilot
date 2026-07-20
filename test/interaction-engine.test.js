import assert from "node:assert/strict";
import test from "node:test";
import {
  globalOptionDefinitions,
  staticCommandDefinitions,
} from "../dist/application/commands/definitions.js";
import { CommandArgvParser } from "../dist/application/commands/parser.js";
import { InteractionEngine } from "../dist/cli/interaction/engine.js";
import { InteractionSession } from "../dist/cli/interaction/prompter.js";
import { navigateResourceCommand } from "../dist/cli/interaction/resource-navigation.js";

const provider = { values: async () => [] };

test("interaction engine completes definition fields without command branching", async () => {
  const parsed = await new CommandArgvParser(
    staticCommandDefinitions,
    globalOptionDefinitions,
    provider,
  ).parse(["language", "set"]);
  const session = new InteractionSession("en", {
    choose: async () => "zh-CN",
    value: async () => undefined,
  });
  const completed = await new InteractionEngine(session, "en", {
    "supported-locales": () => [
      { value: "en", label: "English" },
      { value: "zh-CN", label: "简体中文" },
    ],
  }).complete(parsed);
  assert.deepEqual(completed, {
    path: ["language", "set", "zh-CN"],
    values: {},
  });
});

test("interaction engine inserts a provider-backed configuration argument", async () => {
  const parsed = await new CommandArgvParser(
    staticCommandDefinitions,
    globalOptionDefinitions,
    provider,
  ).parse(["config", "get"]);
  const session = new InteractionSession("en", {
    choose: async () => "project.name",
    value: async () => undefined,
  });
  const completed = await new InteractionEngine(session, "en", {
    "configuration-keys": () => [{ value: "project.name" }],
  }).complete(parsed);
  assert.deepEqual(completed.path, ["config", "get", "project.name"]);
});

test("interaction recipes can select one option and use prior field values", async () => {
  const parsed = await new CommandArgvParser(
    staticCommandDefinitions,
    globalOptionDefinitions,
    provider,
  ).parse(["config", "set"]);
  const selected = ["project.name", "project", "BenchPilot"];
  const session = new InteractionSession("en", {
    choose: async () => selected.shift(),
    value: async () => selected.shift(),
  });
  const completed = await new InteractionEngine(session, "en", {
    "configuration-keys": () => [{ value: "project.name" }],
    "configuration-scopes": ({ values }) => {
      assert.equal(values.key, "project.name");
      return [{ value: "project" }];
    },
    "configuration-values": ({ values }) => {
      assert.equal(values.key, "project.name");
      return undefined;
    },
  }).complete(parsed);
  assert.deepEqual(completed, {
    path: ["config", "set", "project.name", "BenchPilot"],
    values: { project: true },
  });
});

test("interaction recipes can serialize multi-select values", async () => {
  const parsed = await new CommandArgvParser(
    staticCommandDefinitions,
    globalOptionDefinitions,
    provider,
  ).parse(["config", "set"]);
  const selected = ["adapters.enabled", "project"];
  const session = new InteractionSession("en", {
    choose: async () => selected.shift(),
    chooseMany: async () => ["demo", "esp-idf"],
    value: async () => undefined,
  });
  const completed = await new InteractionEngine(session, "en", {
    "configuration-keys": () => [{ value: "adapters.enabled" }],
    "configuration-scopes": () => [{ value: "project" }],
    "configuration-values": () => ({
      choices: [{ value: "demo" }, { value: "esp-idf" }],
      multiple: true,
      serialize: "json",
    }),
  }).complete(parsed);
  assert.deepEqual(completed.path, [
    "config",
    "set",
    "adapters.enabled",
    '["demo","esp-idf"]',
  ]);
  assert.deepEqual(completed.values, { project: true });
});

test("locale recipe steps update the active interaction session", async () => {
  const parsed = await new CommandArgvParser(
    staticCommandDefinitions,
    globalOptionDefinitions,
    provider,
  ).parse(["init", "--project-name", "Demo"]);
  const session = new InteractionSession("en", {
    choose: async () => "zh-CN",
    chooseMany: async () => [],
    value: async () => undefined,
  });
  const selectedLocales = [];
  const setLocale = session.setLocale.bind(session);
  session.setLocale = (locale) => {
    selectedLocales.push(locale);
    setLocale(locale);
  };
  const completed = await new InteractionEngine(session, "en", {
    "supported-locales": () => [{ value: "zh-CN" }],
    "available-adapters": () => ({ choices: [], multiple: true }),
  }).complete(parsed);
  assert.deepEqual(selectedLocales, ["zh-CN"]);
  assert.equal(completed.values.locale, "zh-CN");
});

test("resource navigation composes static actions and dynamic records", async () => {
  const selected = ["run-1", "show"];
  const session = new InteractionSession("en", {
    choose: async () => selected.shift(),
    value: async () => undefined,
  });
  assert.deepEqual(
    await navigateResourceCommand({
      path: ["run"],
      root: "run",
      rootChoices: [{ value: "list", label: "List" }],
      resources: async () => [{ value: "run-1", label: "Run 1" }],
      actionChoices: async () => [{ value: "show", label: "Show" }],
      interaction: () => session,
      color: false,
    }),
    ["run", "run-1", "show"],
  );
});

test("conditional recipe fields collect the value for a selected option", async () => {
  const parsed = await new CommandArgvParser(
    staticCommandDefinitions,
    globalOptionDefinitions,
    provider,
  ).parse(["run", "prune"]);
  const session = new InteractionSession("en", {
    choose: async () => "keep",
    value: async () => "3",
  });
  const completed = await new InteractionEngine(session, "en", {
    "run-prune-mode": () => [{ value: "keep", label: "Keep" }],
  }).complete(parsed);
  assert.deepEqual(completed, {
    path: ["run", "prune"],
    values: { keep: "3" },
  });
});
