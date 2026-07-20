import assert from "node:assert/strict";
import test from "node:test";
import { staticCommandDefinitions } from "../dist/application/commands/definitions.js";
import {
  CommandResolutionError,
  CommandResolver,
} from "../dist/application/commands/resolver.js";

const provider = (calls) => ({
  async values(context) {
    calls.push({
      provider: context.provider,
      captures: { ...context.captures },
    });
    if (context.provider === "adapters") return [{ value: "esp-idf" }];
    if (context.provider === "configured-devices")
      return [{ value: "demo" }, { value: "list" }];
    if (context.provider === "device-capabilities")
      return [
        {
          value: "build",
          summary: { key: "command.device.execute" },
          options: [
            {
              name: "target",
              kind: "option",
              summary: { key: "field.configValue" },
            },
          ],
        },
      ];
    if (context.provider === "configured-systems") return [{ value: "lab" }];
    if (context.provider === "system-capabilities")
      return [{ value: "status" }];
    if (context.provider === "runs") return [{ value: "run-1" }];
    if (context.provider === "locks") return [{ value: "lock-1" }];
    if (context.provider === "approvals") return [{ value: "approval-1" }];
    if (context.provider === "upgrade-versions") return [{ value: "0.2.0" }];
    return [];
  },
});

test("literal paths win without invoking lower-priority dynamic providers", async () => {
  const calls = [];
  const resolver = new CommandResolver(
    staticCommandDefinitions,
    provider(calls),
  );
  const result = await resolver.resolve(["device", "list"]);
  assert.equal(result.definition.id, "device.list");
  assert.deepEqual(calls, []);
});

test("dynamic resources and capabilities resolve through read-only providers", async () => {
  const calls = [];
  const resolver = new CommandResolver(
    staticCommandDefinitions,
    provider(calls),
  );
  const result = await resolver.resolve(["device", "demo", "build"]);
  assert.equal(result.definition.id, "device.execute");
  assert.deepEqual(result.captures, {
    device: "demo",
    capability: "build",
  });
  assert.equal(result.definition.options[0].name, "target");
  assert.deepEqual(
    calls.map((call) => call.provider),
    ["configured-devices", "device-capabilities"],
  );
  assert.deepEqual(calls[1].captures, { device: "demo" });
});

test("resolver supports variadic arguments and every dynamic record family", async () => {
  const calls = [];
  const resolver = new CommandResolver(
    staticCommandDefinitions,
    provider(calls),
  );
  const created = await resolver.resolve([
    "system",
    "create",
    "lab",
    "one",
    "two",
  ]);
  assert.deepEqual(created.captures, {
    name: "lab",
    devices: ["one", "two"],
  });
  assert.equal(
    (await resolver.resolve(["run", "run-1", "artifacts"])).definition.id,
    "run.artifacts",
  );
  assert.equal(
    (await resolver.resolve(["lock", "lock-1", "inspect"])).definition.id,
    "lock.inspect",
  );
  assert.equal(
    (await resolver.resolve(["approval", "approval-1", "inspect"])).definition
      .id,
    "approval.inspect",
  );
  assert.equal(
    (await resolver.resolve(["upgrade", "0.2.0"])).definition.id,
    "upgrade.version",
  );
});

test("unknown and unavailable dynamic values fail with stable resolution codes", async () => {
  const resolver = new CommandResolver(staticCommandDefinitions, provider([]));
  await assert.rejects(
    resolver.resolve(["setup"]),
    (error) =>
      error instanceof CommandResolutionError &&
      error.code === "UNKNOWN_COMMAND",
  );
  await assert.rejects(
    resolver.resolve(["device", "missing", "build"]),
    (error) =>
      error instanceof CommandResolutionError &&
      error.code === "UNKNOWN_COMMAND",
  );
});
