import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  mkdtemp,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, sep } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { AdapterBundleLoader } from "../dist/adapters/runtime/bundle-loader.js";
import { createDeclarativeAdapter } from "../dist/adapters/runtime/declarative-adapter.js";
import {
  discoverDevicesDetailed,
  serialCandidates,
} from "../dist/adapters/runtime/devices/discovery.js";
import { AdapterRuntimeError } from "../dist/adapters/runtime/errors.js";
import { EnvironmentResolver } from "../dist/adapters/runtime/environments/resolver.js";
import { executeProcess } from "../dist/adapters/runtime/executors/process-executor.js";
import { executeCopy } from "../dist/adapters/runtime/executors/copy-executor.js";
import { executeUnsupportedSerial } from "../dist/adapters/runtime/executors/unsupported-executor.js";
import { executeWorkflow } from "../dist/adapters/runtime/executors/workflow-executor.js";
import { collectArtifacts } from "../dist/adapters/runtime/rules/artifact-collector.js";
import { parseOutput } from "../dist/adapters/contract/rules.js";
import { ExecutionDeadline } from "../dist/adapters/runtime/capability-runner.js";
import { planLaunch } from "../dist/adapters/runtime/planning/launch-plan.js";
import { RuntimeAdapterRegistry } from "../dist/adapters/runtime/registry.js";
import { ToolResolver } from "../dist/adapters/runtime/tools/resolver.js";
import {
  AdapterDataValidator,
  redactSecrets,
} from "../dist/adapters/runtime/validation/data-validator.js";
import { SecretRedactor } from "../dist/adapters/runtime/validation/secret-redactor.js";
import { inspectSchemaProperties } from "../dist/adapters/runtime/validation/schema-inspector.js";
import { runProcess } from "../dist/core/process/process-runner.js";
import {
  AdapterRegistry,
  BenchPilotError,
  OperationRunner,
  PathService,
} from "../dist/index.js";

const recordingBusinessLogs = {
  open() {
    return {
      debug() {},
      info() {},
      warn() {},
      event() {},
      async close() {},
    };
  },
};

const bundle = {
  schema: "benchpilot.adapter-bundle",
  schemaVersion: 2,
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
const stable = (value) =>
  JSON.stringify(value, (_key, child) =>
    child && typeof child === "object" && !Array.isArray(child)
      ? Object.fromEntries(
          Object.keys(child)
            .sort()
            .map((key) => [key, child[key]]),
        )
      : child,
  );
bundle.bundleSha256 = createHash("sha256").update(stable(bundle)).digest("hex");

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
          bundleSha256: bundle.bundleSha256,
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
          bundleSha256: bundle.bundleSha256,
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

test("parser progress sampling keeps the first interval and final update", () => {
  const parsed = parseOutput(
    {
      mode: "line",
      encoding: "utf8",
      strip_ansi: true,
      success_exit_codes: [0],
      progress: [
        {
          id: "compile",
          source: "stdout",
          pattern: "\\[(?<current>\\d+)\\/(?<total>\\d+)\\]",
          event: "adapter.compile",
          fields: { current: "integer", total: "integer" },
          sample: { field: "current", final_field: "total", every: 10 },
        },
      ],
    },
    "[1/25] one\n[5/25] two\n[11/25] three\n[20/25] four\n[25/25] done\n",
    "",
    0,
  );
  assert.deepEqual(
    parsed.progress.map((event) => event.data.current),
    [1, 11, 25],
  );
});

test("runtime data validation applies defaults without removing unknown fields", () => {
  const validator = new AdapterDataValidator(bundle);
  const config = {};
  assert.deepEqual(validator.validate("config", config), { enabled: true });
  assert.throws(
    () => validator.validate("config", []),
    (error) =>
      error instanceof AdapterRuntimeError &&
      error.code === "ADAPTER_CONFIG_INVALID",
  );
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

test("schema-aware redaction follows refs, arrays, and composition branches", () => {
  const schema = {
    $defs: {
      credentials: {
        type: "object",
        properties: {
          token: { "x-benchpilot-cli": { secret: true } },
        },
      },
      recursive: {
        type: "object",
        properties: {
          value: { "x-benchpilot-cli": { secret: true } },
          next: { $ref: "#/$defs/recursive" },
        },
      },
    },
    type: "object",
    properties: {
      auth: { $ref: "#/$defs/credentials" },
      tokens: {
        type: "array",
        items: { $ref: "#/$defs/credentials" },
      },
      alternate: {
        oneOf: [
          {
            type: "object",
            properties: {
              password: { "x-benchpilot-cli": { secret: true } },
            },
          },
        ],
      },
      recursive: { $ref: "#/$defs/recursive" },
    },
  };
  assert.deepEqual(
    redactSecrets(schema, {
      auth: { token: "one" },
      tokens: [{ token: "two" }],
      alternate: { password: "three" },
      recursive: { value: "four", next: { value: "five" } },
    }),
    {
      auth: { token: "[REDACTED]" },
      tokens: [{ token: "[REDACTED]" }],
      alternate: { password: "[REDACTED]" },
      recursive: { value: "[REDACTED]", next: "[REDACTED]" },
    },
  );
});

test("workflow without a local timeout retains the capability deadline and event id", async () => {
  const events = [];
  const context = { result: {} };
  const result = await executeWorkflow(
    { id: "deploy", steps: [{ id: "first", uses: "action:build" }] },
    context,
    new AbortController().signal,
    async () => {
      await new Promise((resolve) => setTimeout(resolve, 15));
      return { built: true };
    },
    (event, data) => events.push({ event, data }),
  );
  assert.deepEqual(result, {
    steps: [{ id: "first", ok: true, result: { built: true } }],
  });
  assert.ok(events.every((event) => event.data.workflowId === "deploy"));
});

test("execution deadlines reduce the timeout available to later actions", async () => {
  const deadline = new ExecutionDeadline(200);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.ok(deadline.remainingMs() > 0);
  assert.ok(deadline.limit(600) < 200);
});

test("passive device discovery scores, deduplicates, and orders stable identities", async () => {
  const { devices } = await discoverDevicesDetailed("demo", {
    discovery: {
      enabled: true,
      sources: [
        {
          id: "serial",
          type: "serial",
          records: [
            { port: "/dev/ttyUSB2", serial_number: "second" },
            { port: "/dev/ttyUSB1", serial_number: "first" },
            { port: "/dev/ttyUSB9", serial_number: "first" },
          ],
        },
      ],
      matchers: [
        {
          id: "has-serial",
          source: "serial",
          field: "serial_number",
          operator: "exists",
          score: 20,
        },
        {
          id: "usb",
          source: "serial",
          field: "port",
          operator: "contains",
          value: "USB",
          score: 1,
        },
      ],
      result: { minimum_score: 20 },
    },
    identity: { fields: ["device.serial_number"], allow_port_fallback: true },
  });
  assert.deepEqual(
    devices.map((device) => ({
      identity: device.identity,
      score: device.score,
      matchedRules: device.matchedRules,
    })),
    [
      { identity: "first", score: 21, matchedRules: ["has-serial", "usb"] },
      { identity: "second", score: 21, matchedRules: ["has-serial", "usb"] },
    ],
  );
});

test("generic serial discovery normalizes passive port metadata", async () => {
  const records = await serialCandidates(async () => [
    {
      path: "/dev/ttyUSB1",
      manufacturer: "Espressif",
      serialNumber: "second",
      pnpId: "usb-303a",
      locationId: "2-1",
      productId: "1001",
      vendorId: "303A",
    },
    { path: "/dev/ttyUSB0" },
  ]);
  assert.deepEqual(records, [
    {
      port: "/dev/ttyUSB0",
      description: "/dev/ttyUSB0",
      hwid: "",
      vid: "",
      pid: "",
      serial_number: "",
      manufacturer: "",
      product: "",
      location: "",
    },
    {
      port: "/dev/ttyUSB1",
      description: "Espressif usb-303a",
      hwid: "usb-303a",
      vid: "303A",
      pid: "1001",
      serial_number: "second",
      manufacturer: "Espressif",
      product: "usb-303a",
      location: "2-1",
    },
  ]);
});

test("device discovery accepts injected passive providers without scanning hardware", async () => {
  const { devices } = await discoverDevicesDetailed(
    "demo",
    {
      discovery: {
        enabled: true,
        sources: [{ id: "network", type: "network" }],
        matchers: [
          {
            id: "address",
            source: "network",
            field: "address",
            operator: "exists",
            score: 1,
          },
        ],
        result: { minimum_score: 1 },
      },
      identity: { fields: ["device.address"], allow_port_fallback: false },
    },
    {
      network: async () => [{ address: "192.0.2.8", name: "board" }],
    },
  );
  assert.deepEqual(
    devices.map((device) => device.fields),
    [{ address: "192.0.2.8", name: "board" }],
  );
});

test("command device discovery uses a Tool Action and parsed records", async () => {
  const platform = process.platform === "win32" ? "windows" : "linux";
  const runtime = {
    bundle: {
      ...bundle,
      id: "command-discovery-demo",
      manifest: { adapter_version: "1.0.0", display_name: "Command Discovery" },
    },
    platform,
    rules: {
      devices: {
        discovery: {
          enabled: true,
          sources: [
            {
              id: "command",
              type: "command",
              action: "list-devices",
              result: "records",
            },
          ],
          matchers: [
            {
              id: "port",
              source: "command",
              field: "port",
              operator: "exists",
              score: 1,
            },
          ],
          result: { minimum_score: 1 },
        },
        identity: { fields: ["device.port"], allow_port_fallback: true },
        probe: { enabled: false, reason: "No hardware probe is needed." },
      },
      tools: {
        node: {
          discovery: "node",
          launch: { mode: "direct", prefix_args: [], environment: "inherit" },
        },
      },
      discoveries: {
        node: {
          validation: { path_type: "file", executable: true },
          candidates: [{ id: "config", type: "config", key: "node_path" }],
        },
      },
      environments: {},
      actions: {
        "list-devices": {
          type: "process",
          tool: "node",
          cwd: "${project.root}",
          timeout: "2s",
          parser: "device-list",
          arguments: [
            { kind: "value", value: "-e" },
            {
              kind: "value",
              value:
                'process.stdout.write(JSON.stringify({devices:[{port:"COM7"}]}))',
            },
          ],
        },
      },
      parsers: {
        "device-list": {
          mode: "json",
          encoding: "utf-8",
          strip_ansi: false,
          success_exit_codes: [0],
          extract: [
            {
              id: "devices",
              source: "stdout",
              type: "json-pointer",
              pointer: "/devices",
              target: "records",
              cast: "json",
              required: true,
            },
          ],
        },
      },
    },
  };
  const devices = await createDeclarativeAdapter(runtime).discover({
    adapterConfig: { node_path: process.execPath },
    paths: new PathService(),
  });
  assert.deepEqual(
    devices.map((device) => device.fields),
    [{ port: "COM7" }],
  );
});

test("adapter discovery accepts only passive context", async () => {
  const platform = process.platform === "win32" ? "windows" : "linux";
  const runtime = {
    bundle: {
      ...bundle,
      id: "probe-demo",
      manifest: { adapter_version: "1.0.0", display_name: "Probe" },
    },
    platform,
    rules: {
      devices: {
        discovery: {
          enabled: true,
          sources: [
            { id: "serial", type: "serial", records: [{ port: "COM8" }] },
          ],
          matchers: [
            {
              id: "port",
              source: "serial",
              field: "port",
              operator: "exists",
              score: 1,
            },
          ],
          result: { minimum_score: 1 },
        },
        identity: { fields: ["device.port"], allow_port_fallback: true },
        probe: {
          enabled: true,
          action: "probe",
          parser: "probe",
          may_reset_device: true,
          destructive: false,
        },
      },
      tools: {
        node: {
          discovery: "node",
          launch: { mode: "direct", prefix_args: [], environment: "inherit" },
        },
      },
      discoveries: {
        node: {
          validation: { path_type: "file", executable: true },
          candidates: [
            { id: "node", type: "fixed", paths: [process.execPath] },
          ],
        },
      },
      environments: {},
      actions: {
        probe: {
          type: "process",
          tool: "node",
          cwd: "${project.root}",
          timeout: "2s",
          arguments: [
            { kind: "value", value: "-e" },
            { kind: "value", value: "process.stdout.write(process.argv[1])" },
            { kind: "value", value: "${device.port}" },
          ],
        },
      },
      parsers: {
        probe: {
          success_exit_codes: [0],
          extract: [
            {
              id: "port",
              source: "stdout",
              type: "regex",
              pattern: "(?<port>.+)",
              target: "port",
              group: "port",
              cast: "string",
              required: true,
            },
          ],
        },
      },
    },
  };
  const adapter = createDeclarativeAdapter(runtime);
  const devices = await adapter.discover({
    adapterConfig: {},
    paths: new PathService(),
  });
  assert.deepEqual(
    devices.map((device) => device.fields),
    [{ port: "COM8" }],
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
      resolver.resolveLaunch(
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
    const resolved = await resolver.resolveLaunch(
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
      resolved.executable,
      await (await import("node:fs/promises")).realpath(first),
    );
    const fallback = await resolver.resolveLaunch(
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
      { config: { tool_path: "" } },
    );
    assert.equal(fallback.candidateId, "fixed");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("tool discovery reads registered installations from a JSON path", async () => {
  const root = await mkdtemp(join(tmpdir(), "benchpilot-runtime-json-path-"));
  try {
    const framework = join(root, "esp-idf");
    const tool = join(framework, "tools", "idf.py");
    const registry = join(root, "idf-env.json");
    await mkdir(join(framework, "tools"), { recursive: true });
    await writeFile(tool, "");
    await writeFile(
      registry,
      JSON.stringify({
        idfInstalled: {
          missing: { path: join(root, "missing") },
          installed: { path: framework },
        },
      }),
    );
    const resolver = new ToolResolver("windows", {});
    const resolved = await resolver.resolveLaunch(
      "idf",
      { idf: { discovery: "idf", launch: { environment: "inherit" } } },
      {
        idf: {
          validation: { path_type: "file", executable: false },
          candidates: [
            {
              id: "registered-installation",
              type: "json-path",
              priority: 1,
              file: registry,
              collection: "idfInstalled",
              path: "path",
              append: ["tools", "idf.py"],
            },
          ],
        },
      },
      {},
    );
    assert.equal(resolved.candidateId, "registered-installation");
    assert.equal(resolved.executable, await realpath(tool));
    assert.equal(resolved.discoveredRoot, framework);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("tool discovery expands the home path for managed Python environments", async () => {
  const root = await mkdtemp(
    join(tmpdir(), "benchpilot-runtime-managed-python-"),
  );
  try {
    const python = join(
      root,
      ".espressif",
      "python_env",
      "idf6.0_py3.10_env",
      "Scripts",
      "python.exe",
    );
    await mkdir(dirname(python), { recursive: true });
    await writeFile(python, "");
    const resolver = new ToolResolver("windows", {});
    const resolved = await resolver.resolveLaunch(
      "python",
      { python: { discovery: "python", launch: { environment: "inherit" } } },
      {
        python: {
          validation: { path_type: "file", executable: false },
          candidates: [
            {
              id: "managed-python",
              type: "glob",
              priority: 1,
              patterns: [
                "${home}/.espressif/python_env/idf*_py*_env/Scripts/python.exe",
              ],
            },
          ],
        },
      },
      { home: root },
    );
    assert.equal(resolved.candidateId, "managed-python");
    assert.equal(resolved.executable, await realpath(python));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("discovery diagnostics retain source failures without output", async () => {
  const detailed = await discoverDevicesDetailed(
    "demo",
    {
      discovery: {
        enabled: true,
        sources: [
          { id: "bad", type: "command" },
          { id: "good", type: "serial", records: [{ port: "COM8" }] },
        ],
        matchers: [
          {
            id: "port",
            source: "good",
            field: "port",
            operator: "exists",
            score: 1,
          },
        ],
        result: { minimum_score: 1 },
      },
      identity: { fields: [], allow_port_fallback: true },
    },
    {
      command: async () => {
        throw new AdapterRuntimeError(
          "ADAPTER_DISCOVERY_FAILED",
          "secret output",
        );
      },
    },
  );
  assert.equal(detailed.devices.length, 1);
  assert.deepEqual(detailed.sources[0].error, {
    kind: "ADAPTER_DISCOVERY_FAILED",
    retryable: false,
  });
  assert.equal(
    JSON.stringify(detailed.sources).includes("secret output"),
    false,
  );
});

test("secret redaction, schema inspection, and capture boundaries are safe", async () => {
  const redactor = new SecretRedactor(["token-value", "abc"]);
  assert.equal(
    redactor.redactText("url/token-value/end"),
    "url/[REDACTED]/end",
  );
  const root = {
    $defs: {
      common: {
        type: "object",
        properties: { token: { type: "array" } },
        required: ["token"],
      },
    },
  };
  assert.deepEqual(
    inspectSchemaProperties(root, { allOf: [{ $ref: "#/$defs/common" }] }),
    [{ name: "token", schema: { type: "array" }, required: true }],
  );
  assert.deepEqual(
    inspectSchemaProperties(
      {},
      {
        oneOf: [
          {
            type: "object",
            properties: { port: { type: "string" } },
            required: ["port"],
          },
          {
            type: "object",
            properties: { port: { type: "string" } },
            required: ["port"],
          },
        ],
      },
    ),
    [{ name: "port", schema: { type: "string" }, required: true }],
  );
  const controller = new AbortController();
  const capture = await runProcess({
    command: process.execPath,
    args: ["-e", "process.stdout.write('ER' + 'x'.repeat(32) + 'ROR')"],
    signal: controller.signal,
    captureOutput: true,
    maxCaptureBytes: 8,
  });
  assert.equal(
    capture.stdout.includes("__BENCHPILOT_OUTPUT_TRUNCATED__"),
    true,
  );
});

test("tool probes parse output and reject an unsuccessful candidate", async () => {
  const resolver = new ToolResolver(
    process.platform === "win32" ? "windows" : "linux",
    process.env,
  );
  const tools = {
    node: {
      discovery: "node",
      launch: { mode: "direct", prefix_args: [], environment: "inherit" },
    },
  };
  const parsers = {
    version: {
      success_exit_codes: [0],
      extract: [
        {
          id: "version",
          source: "stdout",
          type: "regex",
          pattern: "(?<version>v\\d+)",
          target: "version",
          group: "version",
          cast: "string",
          required: true,
        },
      ],
    },
  };
  const discoveries = {
    node: {
      validation: { path_type: "file", executable: true },
      candidates: [
        { id: "node", type: "fixed", priority: 1, paths: [process.execPath] },
      ],
      probe: { args: ["--version"], parser: "version", timeout: "2s" },
    },
  };
  const resolved = await resolver.resolveLaunch("node", tools, discoveries, {});
  const probe = await resolver.probe(
    resolved,
    discoveries,
    {},
    parsers,
    process.env,
    "test",
  );
  assert.match(String(probe.version), /^v\d+/);
  const failingResolver = new ToolResolver(
    process.platform === "win32" ? "windows" : "linux",
    process.env,
  );
  const failingDiscoveries = {
    node: {
      validation: { path_type: "file", executable: true },
      candidates: [
        {
          id: "node",
          type: "fixed",
          priority: 1,
          paths: [process.execPath],
        },
      ],
      probe: {
        args: ["--bad-benchpilot-probe"],
        parser: "version",
        timeout: "2s",
      },
    },
  };
  const failingLaunch = await failingResolver.resolveLaunch(
    "node",
    tools,
    failingDiscoveries,
    {},
  );
  await assert.rejects(
    failingResolver.probe(
      failingLaunch,
      failingDiscoveries,
      {},
      parsers,
      process.env,
      "test",
    ),
    (error) =>
      error instanceof AdapterRuntimeError &&
      error.code === "ADAPTER_TOOL_PROBE_FAILED",
  );
});

test("via-tool probes use the complete launch chain and isolate cache entries", async () => {
  const root = await mkdtemp(join(tmpdir(), "benchpilot-via-tool-"));
  try {
    const script = join(root, "runner.js");
    const target = join(root, "target.js");
    await writeFile(
      script,
      "process.stdout.write(`${process.argv.slice(2).join('|')}|${process.env.PROBE_VALUE}`)",
    );
    await writeFile(target, "// declared target\n");
    const resolver = new ToolResolver(
      process.platform === "win32" ? "windows" : "linux",
      process.env,
    );
    const tools = {
      node: {
        discovery: "node",
        launch: { mode: "direct", prefix_args: [], environment: "inherit" },
      },
      script: {
        discovery: "script",
        launch: {
          mode: "via-tool",
          tool: "node",
          prefix_args: ["${discovery.path}"],
          environment: "probe",
        },
      },
      target: {
        discovery: "target",
        launch: {
          mode: "via-tool",
          tool: "script",
          prefix_args: ["${discovery.path}"],
          environment: "probe",
        },
      },
    };
    const discoveries = {
      node: {
        validation: { path_type: "file", executable: true },
        candidates: [{ id: "node", type: "fixed", paths: [process.execPath] }],
      },
      script: {
        validation: { path_type: "file", executable: false },
        candidates: [{ id: "script", type: "fixed", paths: [script] }],
      },
      target: {
        validation: { path_type: "file", executable: false },
        candidates: [{ id: "target", type: "fixed", paths: [target] }],
        probe: { args: ["probe"], parser: "value", timeout: "2s" },
      },
    };
    const parsers = {
      value: {
        success_exit_codes: [0],
        extract: [
          {
            id: "value",
            source: "stdout",
            type: "regex",
            pattern: "(?<value>[^\\n]+)",
            target: "value",
            group: "value",
            cast: "string",
            required: true,
          },
        ],
      },
    };
    const launch = await resolver.resolveLaunch(
      "target",
      tools,
      discoveries,
      {},
    );
    assert.equal(launch.executable, await realpath(process.execPath));
    assert.deepEqual(launch.argsPrefix, [
      await realpath(script),
      await realpath(target),
    ]);
    const debug = [];
    assert.equal(
      (
        await resolver.probe(
          launch,
          discoveries,
          {},
          parsers,
          { ...process.env, PROBE_VALUE: "first" },
          "demo",
          undefined,
          (message) => debug.push(message),
        )
      ).value,
      `${await realpath(target)}|probe|first`,
    );
    assert.equal(
      debug.some((message) => message.includes("first")),
      false,
    );
    assert.ok(debug.some((message) => message.includes("[REDACTED]")));
    assert.equal(
      (
        await resolver.probe(
          launch,
          discoveries,
          {},
          parsers,
          { ...process.env, PROBE_VALUE: "second" },
          "demo",
        )
      ).value,
      `${await realpath(target)}|probe|second`,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("doctor probes every tool with its declared environment", async () => {
  const platform = process.platform === "win32" ? "windows" : "linux";
  const parser = (pattern) => ({
    success_exit_codes: [0],
    extract: [
      {
        id: "value",
        source: "stdout",
        type: "regex",
        pattern,
        target: "value",
        group: "value",
        cast: "string",
        required: true,
      },
    ],
  });
  const adapter = createDeclarativeAdapter({
    bundle: {
      ...bundle,
      manifest: {
        adapter_version: "1.0.0",
        display_name: "Environment Doctor",
        description: "test",
      },
    },
    platform,
    rules: {
      tools: {
        parent: {
          required: true,
          discovery: "parent",
          launch: { mode: "direct", prefix_args: [], environment: "parent" },
        },
        child: {
          required: true,
          discovery: "child",
          launch: {
            mode: "via-tool",
            tool: "parent",
            prefix_args: [],
            environment: "child",
          },
        },
      },
      discoveries: {
        parent: {
          validation: { path_type: "file", executable: true },
          candidates: [{ id: "config", type: "config", key: "node_path" }],
          probe: {
            args: [
              "-e",
              "process.stdout.write(process.env.PARENT_VALUE ?? 'missing')",
            ],
            parser: "parent",
          },
        },
        child: {
          validation: { path_type: "file", executable: true },
          candidates: [{ id: "config", type: "config", key: "node_path" }],
          probe: {
            args: [
              "-e",
              "process.stdout.write(process.env.CHILD_VALUE ?? 'missing')",
            ],
            parser: "child",
          },
        },
      },
      environments: {
        parent: {
          strategy: "first-valid",
          providers: [
            {
              id: "parent",
              type: "static",
              variables: { PARENT_VALUE: "parent" },
            },
          ],
        },
        child: {
          strategy: "first-valid",
          providers: [
            {
              id: "child",
              type: "static",
              variables: { CHILD_VALUE: "child" },
            },
          ],
        },
      },
      parsers: {
        parent: parser("(?<value>parent)"),
        child: parser("(?<value>child)"),
      },
      devices: { discovery: { enabled: false } },
    },
  });
  const checks = await adapter.doctor({
    adapterConfig: { node_path: process.execPath },
    paths: new PathService(),
  });
  assert.equal(
    checks.find((check) => check.id === "demo-tool-parent").status,
    "pass",
  );
  assert.equal(
    checks.find((check) => check.id === "demo-tool-child").status,
    "pass",
  );
});

test("passive discovery never launches a declared probe action", async () => {
  const root = await mkdtemp(join(tmpdir(), "benchpilot-probe-lease-loss-"));
  const started = join(root, "probe-started");
  try {
    const runtime = {
      bundle: {
        ...bundle,
        manifest: {
          adapter_version: "1.0.0",
          display_name: "Probe Lease",
          description: "test",
        },
      },
      platform: process.platform === "win32" ? "windows" : "linux",
      rules: {
        devices: {
          identity: { fields: ["device.serial"] },
          discovery: {
            enabled: true,
            sources: [
              { id: "fixture", type: "usb", records: [{ serial: "device-1" }] },
            ],
            result: { minimum_score: 0 },
          },
          probe: { enabled: true, action: "probe", parser: "probe" },
        },
        tools: {
          node: {
            discovery: "node",
            launch: { mode: "direct", prefix_args: [], environment: "inherit" },
          },
        },
        discoveries: {
          node: {
            validation: { path_type: "file", executable: true },
            candidates: [
              { id: "node", type: "fixed", paths: [process.execPath] },
            ],
          },
        },
        environments: {},
        actions: {
          probe: {
            type: "process",
            tool: "node",
            cwd: "${project.root}",
            timeout: "5s",
            arguments: [
              { kind: "literal", value: "-e" },
              {
                kind: "literal",
                value: `require('node:fs').writeFileSync(${JSON.stringify(started)}, 'started'); setTimeout(() => {}, 5_000)`,
              },
            ],
            parser: "probe",
          },
        },
        parsers: { probe: { success_exit_codes: [0] } },
      },
    };
    const discovered = await createDeclarativeAdapter(runtime).discoverDetailed(
      {
        adapterConfig: {},
        paths: new PathService({ TEMP: join(root, "runtime") }, "win32"),
      },
    );
    assert.equal(discovered.devices.length, 1);
    assert.equal(existsSync(started), false);
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

test(
  "capture-script environments run a fixed script and parse its sentinel",
  { skip: process.platform === "win32" },
  async () => {
    const root = await mkdtemp(
      join(tmpdir(), "benchpilot-runtime-environment-"),
    );
    try {
      const script = join(root, "environment.sh");
      await writeFile(script, "export BENCHPILOT_CAPTURED=ok\n");
      const environment = await new EnvironmentResolver({
        PATH: process.env.PATH,
      }).resolve(
        "captured",
        {
          captured: {
            strategy: "first-valid",
            providers: [
              {
                id: "script",
                type: "capture-script",
                script: "${config.root}/environment.sh",
                shell: "posix",
                priority: 1,
              },
            ],
          },
        },
        { config: { root } },
        new AbortController().signal,
      );
      assert.equal(environment.BENCHPILOT_CAPTURED, "ok");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);

test(
  "capture-script environments compose Windows script paths without a shell string",
  { skip: process.platform !== "win32" },
  async () => {
    const root = await mkdtemp(
      join(tmpdir(), "benchpilot-runtime-environment-windows-"),
    );
    try {
      await writeFile(
        join(root, "environment.cmd"),
        "@echo off\r\nset BENCHPILOT_CAPTURED=windows\r\n",
      );
      const environment = await new EnvironmentResolver({
        PATH: process.env.PATH,
      }).resolve(
        "captured",
        {
          captured: {
            strategy: "first-valid",
            providers: [
              {
                id: "script",
                type: "capture-script",
                script: "${config.root}/environment.cmd",
                shell: "cmd",
                priority: 1,
              },
            ],
          },
        },
        { config: { root } },
        new AbortController().signal,
      );
      assert.equal(environment.BENCHPILOT_CAPTURED, "windows");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);

test("capture-script environments persist a delta cache and invalidate by script mtime", async () => {
  const root = await mkdtemp(
    join(tmpdir(), "benchpilot-runtime-environment-cache-"),
  );
  try {
    const windows = process.platform === "win32";
    const script = join(root, windows ? "environment.cmd" : "environment.sh");
    const marker = join(root, "captures.txt");
    const source = (value) =>
      windows
        ? `@echo off\r\necho capture>>"${marker}"\r\nset BENCHPILOT_CACHE=${value}\r\n`
        : `printf 'capture\\n' >> ${JSON.stringify(marker)}\nexport BENCHPILOT_CACHE=${value}\n`;
    const definitions = {
      captured: {
        strategy: "first-valid",
        providers: [
          {
            id: "script",
            type: "capture-script",
            script,
            shell: windows ? "cmd" : "posix",
            priority: 1,
          },
        ],
      },
    };
    const base = { PATH: process.env.PATH, UNCHANGED: "keep" };
    const context = { config: { root } };
    const cacheRoot = join(root, "cache");
    await writeFile(script, source("first"));
    assert.equal(
      (
        await new EnvironmentResolver(base, cacheRoot).resolve(
          "captured",
          definitions,
          context,
          new AbortController().signal,
        )
      ).BENCHPILOT_CACHE,
      "first",
    );
    assert.equal(
      (
        await new EnvironmentResolver(base, cacheRoot).resolve(
          "captured",
          definitions,
          context,
          new AbortController().signal,
        )
      ).UNCHANGED,
      "keep",
    );
    assert.equal((await readFile(marker, "utf8")).match(/capture/g)?.length, 1);
    if (windows)
      assert.deepEqual(await readdir(join(root, "environment-capture")), []);
    await writeFile(script, source("second"));
    const future = new Date(Date.now() + 2_000);
    await utimes(script, future, future);
    assert.equal(
      (
        await new EnvironmentResolver(base, cacheRoot).resolve(
          "captured",
          definitions,
          context,
          new AbortController().signal,
        )
      ).BENCHPILOT_CACHE,
      "second",
    );
    assert.equal((await readFile(marker, "utf8")).match(/capture/g)?.length, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test(
  "artifact collection filters unsafe matches before cardinality and cleans failed registrations",
  { skip: process.platform === "win32" },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "benchpilot-artifacts-"));
    try {
      const runDir = join(root, "run");
      await mkdir(runDir);
      await writeFile(join(root, "firmware.bin"), "firmware");
      await symlink(join(root, "firmware.bin"), join(root, "linked.bin"));
      const set = {
        base: ".",
        entries: [
          {
            id: "firmware",
            kind: "firmware",
            glob: "*.bin",
            required: true,
            multiple: false,
          },
        ],
      };
      const artifacts = await collectArtifacts(
        set,
        {},
        { dir: runDir },
        {
          register: async (record) => ({ id: "artifact", ...record }),
        },
        [root],
        root,
      );
      assert.equal(artifacts.length, 1);
      assert.equal(artifacts[0].metadata.sourceRelativePath, "firmware.bin");
      await assert.rejects(
        collectArtifacts(
          {
            ...set,
            entries: [{ ...set.entries[0], glob: "linked.bin" }],
          },
          {},
          { dir: runDir },
          { register: async (record) => ({ id: "artifact", ...record }) },
          [root],
          root,
        ),
        (error) =>
          error instanceof AdapterRuntimeError &&
          error.code === "ADAPTER_ARTIFACT_UNSAFE",
      );
      await assert.rejects(
        collectArtifacts(
          set,
          {},
          { dir: join(root, "failed-run") },
          {
            register: async () => {
              throw new Error("registry unavailable");
            },
          },
          [root],
          root,
        ),
      );
      assert.deepEqual(
        await readdir(join(root, "failed-run", "artifacts")),
        [],
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);

test("artifact registration is the cancellation commit point", async () => {
  const root = await mkdtemp(join(tmpdir(), "benchpilot-artifact-commit-"));
  try {
    const runDir = join(root, "run");
    const controller = new AbortController();
    await mkdir(runDir);
    await writeFile(join(root, "firmware.bin"), "firmware");
    const artifacts = await collectArtifacts(
      {
        base: ".",
        entries: [{ id: "firmware", path: "firmware.bin", required: true }],
      },
      {},
      { dir: runDir },
      {
        register: async (record) => {
          controller.abort(new Error("late abort"));
          return { id: "artifact", ...record };
        },
      },
      [root],
      root,
      controller.signal,
    );
    assert.equal(artifacts.length, 1);
    assert.equal(
      await readFile(join(runDir, "artifacts", "firmware.bin"), "utf8"),
      "firmware",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("process launch plans use argv and parse structured output", async () => {
  assert.throws(
    () =>
      planLaunch(
        {
          type: "process",
          tool: "node",
          cwd: "${project.root}",
          arguments: [],
        },
        {},
        { executable: process.execPath, argsPrefix: [] },
        {},
      ),
    (error) =>
      error instanceof AdapterRuntimeError &&
      error.code === "ADAPTER_TEMPLATE_VALUE_MISSING",
  );
  const plan = planLaunch(
    {
      type: "process",
      tool: "node",
      cwd: "${project.root}",
      arguments: [
        { kind: "literal", value: "-e" },
        {
          kind: "literal",
          value:
            "console.log('value=3'); console.log('progress=2'); setTimeout(() => {}, 50)",
        },
      ],
    },
    { project: { root: process.cwd() } },
    { executable: process.execPath, argsPrefix: [] },
    {},
  );
  assert.equal(plan.kind, "process");
  const events = [];
  const logs = [];
  let completed = false;
  let progressBeforeCompletion = false;
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
    (event, data) => {
      progressBeforeCompletion ||= !completed;
      events.push({ event, data });
    },
    {
      info: (line) => logs.push({ level: "info", line }),
      warn: (line) => logs.push({ level: "warn", line }),
    },
  );
  completed = true;
  assert.deepEqual(result.result, { value: 3 });
  assert.deepEqual(events, [{ event: "build.progress", data: { current: 2 } }]);
  assert.ok(
    logs.some((entry) => entry.level === "info" && entry.line === "value=3"),
  );
  assert.equal(progressBeforeCompletion, true);
  assert.throws(
    executeUnsupportedSerial,
    (error) =>
      error instanceof AdapterRuntimeError &&
      error.code === "ADAPTER_EXECUTOR_UNAVAILABLE",
  );
});

test("streaming progress handles split UTF-8, ANSI, and an unterminated tail once", async () => {
  const events = [];
  await executeProcess(
    {
      kind: "process",
      executable: process.execPath,
      args: [
        "-e",
        "process.stdout.write(Buffer.from([0xe8, 0xbf])); setTimeout(() => process.stdout.write(Buffer.concat([Buffer.from([0x9b]), Buffer.from(' progress=7\\n\\x1b[31mprogress=8\\x1b[0m\\nprogress=9')])), 5)",
      ],
      cwd: process.cwd(),
      env: process.env,
      timeoutMs: 10_000,
    },
    {
      strip_ansi: true,
      success_exit_codes: [0],
      progress: [
        {
          id: "progress",
          source: "stdout",
          pattern: "progress=(?<value>\\d+)",
          event: "progress",
          fields: { value: "integer" },
        },
      ],
    },
    new AbortController().signal,
    (event, data) => events.push({ event, data }),
  );
  assert.deepEqual(events, [
    { event: "progress", data: { value: 7 } },
    { event: "progress", data: { value: 8 } },
    { event: "progress", data: { value: 9 } },
  ]);
});

test("process parsing retains tail errors while capture stays bounded", async () => {
  await assert.rejects(
    executeProcess(
      {
        kind: "process",
        executable: process.execPath,
        args: [
          "-e",
          "process.stdout.write('x'.repeat(10 * 1024 * 1024) + 'FATAL: tail')",
        ],
        cwd: process.cwd(),
        env: process.env,
        timeoutMs: 10_000,
      },
      {
        success_exit_codes: [0],
        errors: [
          {
            kind: "tail-error",
            source: "stdout",
            pattern: "FATAL: tail",
            priority: 1,
          },
        ],
      },
      new AbortController().signal,
    ),
    (error) =>
      error instanceof AdapterRuntimeError &&
      error.code === "ADAPTER_PARSER_FAILED" &&
      error.message === "Parser matched tail-error." &&
      error.details?.parserKind === "tail-error",
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
  await assert.rejects(
    executeWorkflow(
      {
        timeout: "1s",
        stop_on_failure: true,
        steps: [
          {
            id: "missing",
            uses: "action:missing",
            with: { value: "${input.missing}" },
          },
        ],
      },
      { input: {} },
      new AbortController().signal,
      async () => ({}),
    ),
    (error) =>
      error instanceof AdapterRuntimeError &&
      error.code === "ADAPTER_TEMPLATE_VALUE_MISSING",
  );
});

test("workflow control flow cannot be continued and never emits completed", async () => {
  const external = new AbortController();
  const externalEvents = [];
  const externalReason = new Error("external abort");
  await assert.rejects(
    executeWorkflow(
      {
        timeout: "1s",
        stop_on_failure: false,
        steps: [
          {
            id: "first",
            uses: "action:first",
            with: {},
            continue_on_error: true,
          },
          { id: "second", uses: "action:second", with: {} },
        ],
      },
      { result: {} },
      external.signal,
      async (id) => {
        if (id === "first") external.abort(externalReason);
        throw new Error("action failed");
      },
      (event) => externalEvents.push(event),
    ),
    (error) => error === externalReason,
  );
  assert.deepEqual(externalEvents, [
    "adapter.workflow.started",
    "adapter.workflow.step.started",
  ]);

  const timeoutEvents = [];
  await assert.rejects(
    executeWorkflow(
      {
        timeout: "1ms",
        stop_on_failure: false,
        steps: [{ id: "slow", uses: "action:slow", with: {} }],
      },
      { result: {} },
      new AbortController().signal,
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        return {};
      },
      (event) => timeoutEvents.push(event),
    ),
    (error) =>
      error instanceof AdapterRuntimeError &&
      error.code === "ADAPTER_WORKFLOW_TIMEOUT",
  );
  assert.equal(timeoutEvents.includes("adapter.workflow.completed"), false);
});

test("copy actions stay inside their allowed roots", async () => {
  const root = await mkdtemp(join(tmpdir(), "benchpilot-runtime-copy-"));
  try {
    const source = join(root, "source.txt");
    const target = join(root, "nested", "target.txt");
    await writeFile(source, "copy me");
    assert.deepEqual(
      await executeCopy(
        {
          kind: "copy",
          from: source,
          to: target,
          recursive: false,
          overwrite: false,
          timeoutMs: 1_000,
        },
        [root],
      ),
      { from: await realpath(source), to: target, copied: true },
    );
    assert.equal(await readFile(target, "utf8"), "copy me");
    const aborted = new AbortController();
    aborted.abort({ kind: "timeout" });
    await assert.rejects(
      executeCopy(
        {
          kind: "copy",
          from: source,
          to: join(root, "aborted.txt"),
          recursive: false,
          overwrite: false,
          timeoutMs: 1_000,
        },
        [root],
        undefined,
        aborted.signal,
      ),
    );
    assert.equal(
      await lstat(join(root, "aborted.txt")).catch(() => undefined),
      undefined,
    );
    await assert.rejects(
      executeCopy(
        {
          kind: "copy",
          from: process.execPath,
          to: target,
          recursive: false,
          overwrite: true,
          timeoutMs: 1_000,
        },
        [root],
      ),
      (error) =>
        error instanceof AdapterRuntimeError &&
        error.code === "ADAPTER_ARTIFACT_UNSAFE",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("copy abort after commit restores the previous target", async () => {
  const root = await mkdtemp(join(tmpdir(), "benchpilot-copy-rollback-"));
  try {
    const source = join(root, "source.txt");
    const target = join(root, "target.txt");
    await writeFile(source, "new");
    await writeFile(target, "old");
    const afterCommitAbort = {
      reason: new Error("abort after rename"),
      get aborted() {
        return existsSync(target) && readFileSync(target, "utf8") === "new";
      },
    };
    await assert.rejects(
      executeCopy(
        {
          kind: "copy",
          from: source,
          to: target,
          recursive: false,
          overwrite: true,
          timeoutMs: 1_000,
        },
        [root],
        undefined,
        afterCommitAbort,
      ),
      (error) =>
        error instanceof AdapterRuntimeError &&
        error.code === "ADAPTER_ARTIFACT_UNSAFE",
    );
    assert.equal(await readFile(target, "utf8"), "old");
    assert.deepEqual(
      (await readdir(root)).filter((entry) => entry.includes(".benchpilot-")),
      [],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("run temp is available to copy actions and artifact collection", async () => {
  const root = await mkdtemp(join(tmpdir(), "benchpilot-run-temp-"));
  try {
    const runDir = join(root, "run");
    const temp = join(runDir, "tmp");
    const source = join(temp, "source.bin");
    const destination = join(runDir, "output.bin");
    await mkdir(temp, { recursive: true });
    await writeFile(source, "firmware");
    const runtime = {
      bundle: {
        ...bundle,
        manifest: {
          adapter_version: "1.0.0",
          display_name: "Run Temp",
          description: "test",
        },
        capabilityCatalog: { capabilities: { copy: { description: "copy" } } },
        schemas: {
          ...bundle.schemas,
          outputs: {
            ...bundle.schemas.outputs,
            $defs: {
              copy: {
                type: "object",
                properties: {
                  from: { type: "string" },
                  to: { type: "string" },
                  copied: { type: "boolean" },
                },
                required: ["from", "to", "copied"],
                additionalProperties: false,
              },
            },
          },
        },
      },
      platform: process.platform === "win32" ? "windows" : "linux",
      rules: {
        capabilities: {
          copy: {
            enabled: true,
            handler: "action:copy",
            input_schema: "build",
            output_schema: "copy",
            creates_run: true,
            timeout: "5s",
            lock: "none",
            safety: { mode: "normal" },
            platforms: { windows: true, linux: true, macos: true },
          },
        },
        devices: { identity: { allow_instance_fallback: true } },
        actions: {
          copy: {
            type: "copy",
            from: "${temp}/source.bin",
            to: "${run.dir}/output.bin",
            recursive: false,
            overwrite: false,
            timeout: "5s",
            artifact_set: "output",
          },
        },
        artifacts: {
          output: {
            base: ".",
            entries: [{ id: "output", path: "output.bin", required: true }],
          },
        },
        tools: {},
        discoveries: {},
        environments: {},
        workflows: {},
        parsers: {},
      },
    };
    const device = await createDeclarativeAdapter(runtime).createDevice(
      "fixture",
      {},
      { adapterConfig: {} },
    );
    const registered = [];
    const result = await device.capabilities()[0].execute(
      {
        signal: new AbortController().signal,
        logger: { debug() {} },
        run: { id: "run", dir: runDir },
        stateRoot: root,
        project: { root },
        config: {},
        device,
        registerCleanup() {},
        dangerousEffect: { started: false },
        markDangerousEffectStarted() {},
        emitEvent() {},
        async registerArtifact(record) {
          const artifact = { id: "artifact", ...record };
          registered.push(artifact);
          return artifact;
        },
      },
      {},
    );
    assert.deepEqual(result, {
      from: await realpath(source),
      to: destination,
      copied: true,
    });
    assert.equal(await readFile(destination, "utf8"), "firmware");
    assert.equal(registered[0].path, join(runDir, "artifacts", "output.bin"));
    assert.equal(await readFile(registered[0].path, "utf8"), "firmware");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test(
  "copy rejects symlink escapes and replaces an existing file safely",
  { skip: process.platform === "win32" },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "benchpilot-copy-links-"));
    const outside = await mkdtemp(join(tmpdir(), "benchpilot-copy-outside-"));
    try {
      const source = join(root, "source.txt");
      await writeFile(source, "new");
      const escaped = join(root, "escaped");
      await symlink(outside, escaped);
      await assert.rejects(
        executeCopy(
          {
            kind: "copy",
            from: source,
            to: join(escaped, "target.txt"),
            recursive: false,
            overwrite: false,
            timeoutMs: 1_000,
          },
          [root],
        ),
        (error) =>
          error instanceof AdapterRuntimeError &&
          error.code === "ADAPTER_ARTIFACT_UNSAFE",
      );
      const linkedTarget = join(root, "linked.txt");
      await symlink(join(outside, "external.txt"), linkedTarget);
      await assert.rejects(
        executeCopy(
          {
            kind: "copy",
            from: source,
            to: linkedTarget,
            recursive: false,
            overwrite: true,
            timeoutMs: 1_000,
          },
          [root],
        ),
        (error) =>
          error instanceof AdapterRuntimeError &&
          error.code === "ADAPTER_ARTIFACT_UNSAFE",
      );
      const sourceDirectory = join(root, "source-directory");
      await mkdir(sourceDirectory);
      await symlink(
        join(outside, "external.txt"),
        join(sourceDirectory, "link"),
      );
      await assert.rejects(
        executeCopy(
          {
            kind: "copy",
            from: sourceDirectory,
            to: join(root, "copied-directory"),
            recursive: true,
            overwrite: false,
            timeoutMs: 1_000,
          },
          [root],
        ),
        (error) =>
          error instanceof AdapterRuntimeError &&
          error.code === "ADAPTER_ARTIFACT_UNSAFE",
      );
      const target = join(root, "target.txt");
      await writeFile(target, "old");
      await executeCopy(
        {
          kind: "copy",
          from: source,
          to: target,
          recursive: false,
          overwrite: true,
          timeoutMs: 1_000,
        },
        [root],
      );
      assert.equal(await readFile(target, "utf8"), "new");
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  },
);

test("declarative adapters execute through the Core operation lifecycle", async () => {
  const root = await mkdtemp(join(tmpdir(), "benchpilot-declarative-core-"));
  try {
    const runtime = {
      bundle: {
        ...bundle,
        manifest: {
          adapter_version: "1.0.0",
          display_name: "Runtime Demo",
          description: "Runtime integration test",
        },
        capabilityCatalog: {
          capabilities: { build: { description: "Build a project" } },
        },
        platforms: {},
      },
      platform: process.platform === "win32" ? "windows" : "linux",
      rules: {
        capabilities: {
          build: {
            enabled: true,
            handler: "workflow:build",
            input_schema: "build",
            output_schema: "build",
            creates_run: true,
            timeout: "10s",
            lock: "none",
            safety: { mode: "normal" },
            platforms: { windows: true, linux: true, macos: true },
          },
        },
        devices: { identity: { fields: ["device.serial"] } },
        tools: {
          node: {
            discovery: "node",
            launch: { mode: "direct", prefix_args: [], environment: "inherit" },
          },
        },
        discoveries: {
          node: {
            validation: { path_type: "file", executable: true },
            candidates: [{ id: "config", type: "config", key: "node_path" }],
          },
        },
        environments: {},
        actions: {
          build: {
            type: "process",
            tool: "node",
            cwd: "${project.root}",
            arguments: [
              { kind: "literal", value: "-e" },
              {
                kind: "literal",
                value:
                  "console.log('value=3'); console.log('temp=' + process.argv[1])",
              },
              { kind: "value", value: "${temp}" },
            ],
            parser: "build",
          },
        },
        workflows: {
          build: {
            timeout: "10s",
            stop_on_failure: true,
            steps: [{ id: "compile", uses: "action:build", with: {} }],
            output_template: {
              value: "${result.compile.value}",
              temp: "${result.compile.temp}",
            },
          },
        },
        parsers: {
          build: {
            success_exit_codes: [0],
            extract: [
              {
                id: "value",
                source: "stdout",
                type: "regex",
                pattern: "value=(?<value>\\d+)",
                group: "value",
                target: "value",
                cast: "integer",
                required: true,
              },
              {
                id: "temp",
                source: "stdout",
                type: "regex",
                pattern: "temp=(?<temp>.+)",
                group: "temp",
                target: "temp",
                cast: "string",
                required: true,
              },
            ],
          },
        },
        artifacts: {},
      },
    };
    runtime.bundle.schemas = {
      config: {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        type: "object",
        properties: {
          token: { type: "string", "x-benchpilot-cli": { secret: true } },
          node_path: { type: "string" },
        },
        additionalProperties: false,
      },
      device: {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        type: "object",
        properties: { serial: { type: "string" } },
        additionalProperties: false,
      },
      inputs: {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        type: "object",
        $defs: { build: { type: "object", additionalProperties: false } },
      },
      outputs: {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        type: "object",
        $defs: {
          build: {
            type: "object",
            properties: {
              value: { type: "integer" },
              temp: { type: "string" },
            },
            required: ["value", "temp"],
            additionalProperties: false,
          },
        },
      },
    };
    const registry = new AdapterRegistry();
    registry.register(createDeclarativeAdapter(runtime));
    const paths = new PathService({ TEMP: join(root, "runtime") }, "win32");
    const result = await new OperationRunner({
      businessLogs: recordingBusinessLogs,
      paths,
      registry,
      project: { root, config: join(root, "benchpilot.toml") },
      config: {
        value: {
          adapters: {
            demo: { token: "runtime-secret", node_path: process.execPath },
          },
          devices: { target: { adapter: "demo", serial: "serial-1" } },
        },
        origins: new Map(),
        layers: [],
      },
    }).execute("target", "build", {});
    assert.equal(result.output.value, 3);
    assert.equal(
      result.output.temp.endsWith(join(result.execution.runId, "tmp")),
      true,
    );
    assert.equal((await lstat(result.output.temp)).isDirectory(), true);
    const snapshots = (
      await readdir(paths.projectStateRoot(root), { recursive: true })
    ).filter((entry) => entry.endsWith("resolved-config.json"));
    assert.equal(snapshots.length, 1);
    const snapshot = await readFile(
      join(paths.projectStateRoot(root), snapshots[0]),
      "utf8",
    );
    assert.match(snapshot, /\[REDACTED\]/);
    assert.doesNotMatch(snapshot, /runtime-secret/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
