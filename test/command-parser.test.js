import assert from "node:assert/strict";
import test from "node:test";
import {
  globalOptionDefinitions,
  staticCommandDefinitions,
} from "../dist/application/commands/definitions.js";
import {
  CommandArgvParser,
  CommandParseError,
} from "../dist/application/commands/parser.js";
import { CommandResolutionError } from "../dist/application/commands/resolver.js";

const provider = {
  async values({ provider }) {
    if (provider === "configured-devices") return [{ value: "demo" }];
    if (provider === "device-capabilities")
      return [
        {
          value: "build",
          options: [
            {
              name: "target",
              kind: "option",
              summary: { key: "field.configValue" },
              value: "string",
            },
            {
              name: "trace",
              kind: "option",
              summary: { key: "field.verbose" },
              value: "boolean",
            },
          ],
        },
      ];
    return [];
  },
};

const parser = () =>
  new CommandArgvParser(
    staticCommandDefinitions,
    globalOptionDefinitions,
    provider,
  );

test("parser builds a definition-driven intent for static commands", async () => {
  const parsed = await parser().parse([
    "config",
    "set",
    "project.name",
    "Demo",
    "--global",
    "--json",
    "--no-color",
  ]);
  assert.equal(parsed.intent.commandId, "config.set");
  assert.deepEqual(parsed.intent.input, {
    key: "project.name",
    value: "Demo",
  });
  assert.deepEqual(parsed.intent.options, { global: true });
  assert.deepEqual(parsed.intent.globals, { json: true, color: false });
  assert.deepEqual(parsed.missingFields, []);
});

test("parser accepts every administrative option declared by the command graph", async () => {
  const listed = await parser().parse([
    "run",
    "list",
    "--status",
    "failed",
    "--limit",
    "20",
  ]);
  assert.deepEqual(listed.intent.options, { status: "failed", limit: "20" });

  const pruned = await parser().parse([
    "run",
    "prune",
    "--older-than",
    "7d",
    "--dangerously-remove-all-runs",
  ]);
  assert.deepEqual(pruned.intent.options, {
    "older-than": "7d",
    "dangerously-remove-all-runs": true,
  });

  const config = await parser().parse([
    "config",
    "get",
    "project.name",
    "--show-origin",
  ]);
  assert.deepEqual(config.intent.options, { "show-origin": true });
});

test("parser uses resolved dynamic Capability fields", async () => {
  const parsed = await parser().parse([
    "device",
    "demo",
    "build",
    "--target",
    "esp32s3",
    "--trace",
  ]);
  assert.equal(parsed.intent.commandId, "device.execute");
  assert.deepEqual(parsed.intent.input, {
    device: "demo",
    capability: "build",
  });
  assert.deepEqual(parsed.intent.options, {
    target: "esp32s3",
    trace: true,
  });
});

test("parser reports missing interactive fields without inventing values", async () => {
  const parsed = await parser().parse(["init"]);
  assert.deepEqual(parsed.missingFields, ["project-name"]);
  assert.equal(parsed.resolved.definition.interaction, "when-incomplete");

  const config = await parser().parse(["config", "set"]);
  assert.equal(config.intent.commandId, "config.set");
  assert.deepEqual(config.missingFields, ["key", "value"]);
});

test("parser validates option conflicts, values, and unknown commands", async () => {
  await assert.rejects(
    parser().parse(["version", "--json", "--jsonl"]),
    (error) =>
      error instanceof CommandParseError && error.code === "OPTION_CONFLICT",
  );
  await assert.rejects(
    parser().parse(["device", "demo", "build", "--target"]),
    (error) =>
      error instanceof CommandParseError &&
      error.code === "MISSING_OPTION_VALUE",
  );
  await assert.rejects(
    parser().parse(["version", "--unknown"]),
    (error) =>
      error instanceof CommandParseError && error.code === "UNKNOWN_OPTION",
  );
  await assert.rejects(
    parser().parse(["setup"]),
    (error) =>
      error instanceof CommandResolutionError &&
      error.code === "UNKNOWN_COMMAND",
  );
});

test("global --version resolves the version command", async () => {
  const parsed = await parser().parse(["--version"]);
  assert.equal(parsed.intent.commandId, "version");
  assert.equal(parsed.intent.globals.version, true);
});
