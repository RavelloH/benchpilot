import assert from "node:assert/strict";
import test from "node:test";
import {
  commandCatalogDefinition,
  staticCommandDefinitions,
} from "../dist/application/commands/definitions.js";
import { HelpDocumentService } from "../dist/application/commands/help.js";

const provider = (calls) => ({
  async values(context) {
    calls.push(context.provider);
    if (context.provider === "configured-devices")
      return [{ value: "demo", summary: { key: "command.device.resource" } }];
    if (context.provider === "device-capabilities")
      return [
        {
          value: "flash",
          summary: { key: "command.device.execute" },
          safety: {
            mode: "destructive",
            flag: "confirm-flash",
            effects: ["writes flash"],
          },
          operation: {
            kind: "static",
            timeoutMs: 60_000,
            lockMode: "exclusive",
            safety: { mode: "destructive", flag: "confirm-flash" },
            createsRun: true,
          },
          options: [
            {
              name: "target",
              kind: "option",
              summary: { key: "field.configValue" },
              value: "string",
            },
          ],
        },
      ];
    return [];
  },
});

test("root HelpDocument comes only from implemented graph roots", async () => {
  const calls = [];
  const document = await new HelpDocumentService(
    commandCatalogDefinition,
    provider(calls),
  ).document([]);
  assert.equal(document.schema, "benchpilot.help");
  assert.equal(document.version, 3);
  assert.equal(document.view, "root-help");
  assert.equal(document.interactionView, "root-menu");
  assert.equal(document.children.length, 14);
  assert.deepEqual(
    document.groups.map((group) => group.id),
    ["interactive", "get-started", "configure", "execute", "records", "help"],
  );
  assert.deepEqual(
    document.globalOptions.map((field) => field.name),
    ["json", "jsonl", "config", "agent", "help"],
  );
  assert.equal(calls.length, 0);
  const output = JSON.stringify(document);
  for (const unavailable of ["setup", "alias", "workflow", "skill", "docs"])
    assert.doesNotMatch(output, new RegExp(`benchpilot ${unavailable}`));
});

test("complete help uses a flat index with required dynamic path segments", async () => {
  const document = await new HelpDocumentService(
    commandCatalogDefinition,
    provider([]),
  ).document([], { includeDynamicValues: true });
  assert.equal(document.view, "all-help");
  assert.ok(
    document.children.some(
      (child) => child.usage === "benchpilot language set <locale>",
    ),
  );
  assert.ok(
    document.children.some(
      (child) => child.usage === "benchpilot adapter <adapter>",
    ),
  );
  assert.doesNotMatch(
    document.children.map((child) => child.usage).join("\n"),
    /\[<adapter>\]|\[<device>\]|\[<run>\]/,
  );
});

test("HelpDocument includes parent context and partial child information", async () => {
  const calls = [];
  const service = new HelpDocumentService(
    commandCatalogDefinition,
    provider(calls),
  );
  const config = await service.document(["config"]);
  assert.equal(config.command.id, "config");
  assert.equal(config.command.executable, false);
  assert.ok(
    config.children.some(
      (child) => child.usage === "benchpilot config set <key> <value>",
    ),
  );
  assert.ok(config.globalOptions.some((field) => field.name === "json"));
  assert.deepEqual(calls, []);
  assert.equal(config.description.key, "help.group.config");
});

test("init help projects static and provider-backed option values", async () => {
  const service = new HelpDocumentService(
    commandCatalogDefinition,
    provider([]),
    {
      values: async ({ provider: providerId }) =>
        providerId === "available-adapters" ? ["demo", "esp-idf"] : [],
    },
  );
  const document = await service.document(["init"]);
  assert.deepEqual(
    document.options.find((field) => field.name === "locale")?.choices,
    ["en", "zh-CN"],
  );
  assert.deepEqual(
    document.options.find((field) => field.name === "adapter")?.choices,
    ["demo", "esp-idf"],
  );
});

test("help output schemas match canonical command DTOs", () => {
  const expected = {
    "language.list": "benchpilot.language-list",
    "config.get": "benchpilot.config-get",
    "adapter.show": "benchpilot.adapter",
    "run.show": "benchpilot.run-detail",
    "lock.inspect": "benchpilot.lock-detail",
    "approval.approve": "benchpilot.approval-change",
    "upgrade.latest": "benchpilot.upgrade",
  };
  for (const [id, schema] of Object.entries(expected))
    assert.equal(
      commandCatalogDefinition.commands.find((command) => command.id === id)
        .output.schema,
      schema,
    );
  assert.equal(
    commandCatalogDefinition.commands.find((command) => command.id === "help")
      .output.version,
    3,
  );
});

test("dynamic Capability help uses resolved safety, fields, and output", async () => {
  const calls = [];
  const service = new HelpDocumentService(
    commandCatalogDefinition,
    provider(calls),
  );
  const document = await service.document(["device", "demo", "flash"]);
  assert.equal(document.command.id, "device.execute");
  assert.equal(document.usage[0], "benchpilot device demo flash");
  assert.equal(document.options[0].name, "target");
  assert.equal(document.safety.mode, "destructive");
  assert.equal(document.safety.flag, "confirm-flash");
  assert.equal(document.output.schema, "benchpilot.operation");
  assert.deepEqual(calls, ["configured-devices", "device-capabilities"]);
});

test("dynamic child values are opt-in for bounded help", async () => {
  const calls = [];
  const service = new HelpDocumentService(
    commandCatalogDefinition,
    provider(calls),
  );
  const bounded = await service.document(["device"]);
  assert.ok(bounded.children.some((child) => /<device>/.test(child.usage)));
  assert.deepEqual(calls, []);
  const expanded = await service.document(["device"], {
    includeDynamicValues: true,
  });
  assert.ok(
    expanded.children.some((child) => /device demo$/.test(child.usage)),
  );
  assert.deepEqual(calls, ["configured-devices"]);
});
