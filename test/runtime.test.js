import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { AdapterBundleLoader } from "../dist/adapters/runtime/bundle-loader.js";
import { AdapterRuntimeError } from "../dist/adapters/runtime/errors.js";
import { EnvironmentResolver } from "../dist/adapters/runtime/environments/resolver.js";
import { executeProcess } from "../dist/adapters/runtime/executors/process-executor.js";
import { executeUnsupportedSerial } from "../dist/adapters/runtime/executors/unsupported-executor.js";
import { executeWorkflow } from "../dist/adapters/runtime/executors/workflow-executor.js";
import { planLaunch } from "../dist/adapters/runtime/planning/launch-plan.js";
import { RuntimeAdapterRegistry } from "../dist/adapters/runtime/registry.js";
import { ToolResolver } from "../dist/adapters/runtime/tools/resolver.js";
import {
  AdapterDataValidator,
  redactSecrets,
} from "../dist/adapters/runtime/validation/data-validator.js";

const bundle = {
  schema: "benchpilot.adapter-bundle",
  schemaVersion: 1,
  id: "demo",
  sourceHash: "source-hash",
  capabilityCatalogVersion: 1,
  capabilityCatalogHash: "catalog-hash",
  manifest: {},
  capabilityCatalog: {},
  platforms: { windows: {}, linux: {}, macos: {} },
  schemas: {
    config: {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      properties: { enabled: { type: "boolean", default: true } },
      additionalProperties: false,
    },
    device: {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      additionalProperties: false,
    },
    inputs: {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      $defs: {
        build: { type: "object", properties: { count: { type: "integer" } } },
      },
    },
    outputs: {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      $defs: { build: { type: "object" } },
    },
  },
};

test("bundle loader uses its module-relative root and validates bundle hashes", async () => {
  const root = await mkdtemp(join(tmpdir(), "benchpilot-runtime-bundle-"));
  try {
    await writeFile(
      join(root, "index.json"),
      JSON.stringify([
        {
          id: "demo",
          displayName: "Demo",
          adapterVersion: "1.0.0",
          status: "active",
          sourceHash: "source-hash",
          path: "demo.json",
          platforms: {},
        },
      ]),
    );
    await writeFile(join(root, "demo.json"), JSON.stringify(bundle));
    const loader = new AdapterBundleLoader(pathToFileURL(`${root}${sep}`));
    const first = await loader.load("demo");
    assert.strictEqual(first, await loader.load("demo"));
    assert.ok(Object.isFrozen(first));
    assert.deepEqual((await loader.loadForPlatform("demo", "linux")).rules, {});
    const registry = new RuntimeAdapterRegistry(loader, "linux");
    assert.equal(await registry.has("demo"), true);
    assert.equal((await registry.list())[0].id, "demo");
    assert.equal((await registry.get("demo")).bundle.id, "demo");
    await writeFile(
      join(root, "index.json"),
      JSON.stringify([
        {
          id: "demo",
          displayName: "Demo",
          adapterVersion: "1.0.0",
          status: "active",
          sourceHash: "wrong",
          path: "demo.json",
          platforms: {},
        },
      ]),
    );
    await assert.rejects(
      new AdapterBundleLoader(pathToFileURL(`${root}${sep}`)).load("demo"),
      (error) =>
        error instanceof AdapterRuntimeError &&
        error.code === "ADAPTER_BUNDLE_HASH_MISMATCH",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("runtime data validation applies defaults without removing unknown fields", () => {
  const validator = new AdapterDataValidator(bundle);
  const config = {};
  assert.deepEqual(validator.validate("config", config), { enabled: true });
  assert.throws(
    () => validator.validate("config", { unknown: true }),
    (error) =>
      error instanceof AdapterRuntimeError &&
      error.code === "ADAPTER_CONFIG_INVALID",
  );
  assert.deepEqual(
    validator.validate("input", { count: "2" }, "build", "build"),
    {
      count: 2,
    },
  );
  assert.deepEqual(
    redactSecrets(
      {
        properties: {
          token: { "x-benchpilot-cli": { secret: true } },
          nested: { properties: { visible: {} } },
        },
      },
      { token: "secret", nested: { visible: "ok" } },
    ),
    { token: "[REDACTED]", nested: { visible: "ok" } },
  );
});

test("tool discovery honors priority and rejects an invalid explicit path", async () => {
  const root = await mkdtemp(join(tmpdir(), "benchpilot-runtime-tools-"));
  try {
    const first = join(root, "first.exe");
    const second = join(root, "second.exe");
    await writeFile(first, "");
    await writeFile(second, "");
    const resolver = new ToolResolver("windows", {});
    const context = { config: { tool_path: join(root, "missing.exe") } };
    await assert.rejects(
      resolver.resolve(
        "tool",
        {
          tool: {
            discovery: "tool-discovery",
            launch: { environment: "inherit" },
          },
        },
        {
          "tool-discovery": {
            validation: { path_type: "file", executable: false },
            candidates: [
              {
                id: "configured",
                type: "config",
                key: "tool_path",
                priority: 10,
              },
              { id: "fixed", type: "fixed", paths: [second], priority: 1 },
            ],
          },
        },
        context,
      ),
      (error) =>
        error instanceof AdapterRuntimeError &&
        error.code === "ADAPTER_TOOL_CONFIG_INVALID",
    );
    const resolved = await resolver.resolve(
      "tool",
      {
        tool: {
          discovery: "tool-discovery",
          launch: { environment: "inherit" },
        },
      },
      {
        "tool-discovery": {
          validation: { path_type: "file", executable: false },
          candidates: [
            { id: "low", type: "fixed", paths: [second], priority: 1 },
            { id: "high", type: "fixed", paths: [first], priority: 10 },
          ],
        },
      },
      { config: {} },
    );
    assert.equal(
      resolved.path,
      await (await import("node:fs/promises")).realpath(first),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("environment resolution supports active, static, and provider fallback", async () => {
  const resolver = new EnvironmentResolver({ PATH: "base", FALLBACK: "yes" });
  const definitions = {
    active: {
      strategy: "first-valid",
      providers: [
        {
          id: "active",
          type: "active",
          priority: 1,
          required_variables: ["PATH"],
        },
      ],
    },
    static: {
      strategy: "first-valid",
      providers: [
        {
          id: "missing",
          type: "active",
          priority: 10,
          required_variables: ["MISSING"],
        },
        {
          id: "static",
          type: "static",
          priority: 1,
          variables: { TARGET: "${input.target}" },
        },
      ],
    },
  };
  assert.equal(
    (
      await resolver.resolve(
        "active",
        definitions,
        {},
        new AbortController().signal,
      )
    ).PATH,
    "base",
  );
  assert.equal(
    (
      await resolver.resolve(
        "static",
        definitions,
        { input: { target: "demo" } },
        new AbortController().signal,
      )
    ).TARGET,
    "demo",
  );
});

test("process launch plans use argv and parse structured output", async () => {
  const plan = planLaunch(
    {
      type: "process",
      tool: "node",
      cwd: "${project.root}",
      arguments: [
        { kind: "literal", value: "-e" },
        {
          kind: "literal",
          value: "console.log('value=3'); console.log('progress=2')",
        },
      ],
    },
    { project: { root: process.cwd() } },
    { path: process.execPath, prefixArgs: [] },
    {},
  );
  assert.equal(plan.kind, "process");
  const events = [];
  const result = await executeProcess(
    plan,
    {
      success_exit_codes: [0],
      extract: [
        {
          id: "value",
          source: "stdout",
          type: "regex",
          pattern: "value=(?<value>\\d+)",
          target: "value",
          group: "value",
          cast: "integer",
          required: true,
        },
      ],
      progress: [
        {
          id: "progress",
          source: "stdout",
          pattern: "progress=(?<current>\\d+)",
          event: "build.progress",
          fields: { current: "integer" },
        },
      ],
    },
    new AbortController().signal,
    (event, data) => events.push({ event, data }),
  );
  assert.deepEqual(result.result, { value: 3 });
  assert.deepEqual(events, [{ event: "build.progress", data: { current: 2 } }]);
  assert.throws(
    executeUnsupportedSerial,
    (error) =>
      error instanceof AdapterRuntimeError &&
      error.code === "ADAPTER_EXECUTOR_UNAVAILABLE",
  );
});

test("workflow execution is ordered and honors continue_on_error", async () => {
  const order = [];
  const context = { result: {} };
  const result = await executeWorkflow(
    {
      timeout: "1s",
      stop_on_failure: true,
      steps: [
        { id: "build", uses: "action:build", with: {} },
        {
          id: "optional",
          uses: "action:optional",
          with: {},
          continue_on_error: true,
        },
        { id: "flash", uses: "action:flash", with: {} },
      ],
    },
    context,
    new AbortController().signal,
    async (id) => {
      order.push(id);
      if (id === "optional") throw new Error("expected");
      return { id };
    },
  );
  assert.deepEqual(order, ["build", "optional", "flash"]);
  assert.deepEqual(
    result.steps.map((step) => step.ok),
    [true, false, true],
  );
});
