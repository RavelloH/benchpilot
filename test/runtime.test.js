import assert from "node:assert/strict";
import {
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { AdapterBundleLoader } from "../dist/adapters/runtime/bundle-loader.js";
import { createDeclarativeAdapter } from "../dist/adapters/runtime/declarative-adapter.js";
import { AdapterRuntimeError } from "../dist/adapters/runtime/errors.js";
import { EnvironmentResolver } from "../dist/adapters/runtime/environments/resolver.js";
import { executeProcess } from "../dist/adapters/runtime/executors/process-executor.js";
import { executeCopy } from "../dist/adapters/runtime/executors/copy-executor.js";
import { executeUnsupportedSerial } from "../dist/adapters/runtime/executors/unsupported-executor.js";
import { executeWorkflow } from "../dist/adapters/runtime/executors/workflow-executor.js";
import { ExecutionDeadline } from "../dist/adapters/runtime/capability-runner.js";
import { planLaunch } from "../dist/adapters/runtime/planning/launch-plan.js";
import { RuntimeAdapterRegistry } from "../dist/adapters/runtime/registry.js";
import { ToolResolver } from "../dist/adapters/runtime/tools/resolver.js";
import {
  AdapterDataValidator,
  redactSecrets,
} from "../dist/adapters/runtime/validation/data-validator.js";
import {
  AdapterRegistry,
  OperationRunner,
  PathService,
} from "../dist/index.js";

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
  const deadline = new ExecutionDeadline(30);
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.ok(deadline.remainingMs() > 0);
  assert.ok(deadline.limit(60) < 30);
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
  const resolved = await resolver.resolve(
    "node",
    tools,
    {
      node: {
        validation: { path_type: "file", executable: true },
        candidates: [
          { id: "node", type: "fixed", priority: 1, paths: [process.execPath] },
        ],
        probe: { args: ["--version"], parser: "version", timeout: "2s" },
      },
    },
    {},
    parsers,
  );
  assert.match(resolved.probe.version, /^v\d+/);
  await assert.rejects(
    new ToolResolver(
      process.platform === "win32" ? "windows" : "linux",
      process.env,
    ).resolve(
      "node",
      tools,
      {
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
      },
      {},
      parsers,
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
    const launch = await resolver.resolve(
      "target",
      tools,
      discoveries,
      {},
      parsers,
      { probe: false },
    );
    assert.equal(launch.executable, await realpath(process.execPath));
    assert.deepEqual(launch.argsPrefix, [
      await realpath(script),
      await realpath(target),
    ]);
    assert.equal(
      (
        await resolver.probe(
          launch,
          discoveries,
          {},
          parsers,
          { ...process.env, PROBE_VALUE: "first" },
          "demo",
        )
      ).value,
      `${await realpath(target)}|probe|first`,
    );
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
                script,
                shell: "posix",
                priority: 1,
              },
            ],
          },
        },
        {},
        new AbortController().signal,
      );
      assert.equal(environment.BENCHPILOT_CAPTURED, "ok");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);

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
        { path: process.execPath, prefixArgs: [] },
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
    { path: process.execPath, prefixArgs: [] },
    {},
  );
  assert.equal(plan.kind, "process");
  const events = [];
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
  );
  completed = true;
  assert.deepEqual(result.result, { value: 3 });
  assert.deepEqual(events, [{ event: "build.progress", data: { current: 2 } }]);
  assert.equal(progressBeforeCompletion, true);
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
            handler: "action:build",
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
            candidates: [
              { id: "node", type: "fixed", paths: [process.execPath] },
            ],
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
              { kind: "literal", value: "console.log('value=3')" },
            ],
            parser: "build",
          },
        },
        workflows: {},
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
            properties: { value: { type: "integer" } },
            required: ["value"],
            additionalProperties: false,
          },
        },
      },
    };
    const registry = new AdapterRegistry();
    registry.register(createDeclarativeAdapter(runtime));
    const paths = new PathService({ BENCHPILOT_HOME: root });
    const result = await new OperationRunner({
      paths,
      registry,
      project: undefined,
      flags: { quiet: true },
      config: {
        value: {
          adapters: { demo: { token: "runtime-secret" } },
          devices: { target: { adapter: "demo", serial: "serial-1" } },
        },
        origins: new Map(),
        layers: [],
      },
    }).execute("target", "build", {});
    assert.deepEqual(result.data, { value: 3 });
    const snapshots = (
      await readdir(paths.stateRoot(), { recursive: true })
    ).filter((entry) => entry.endsWith("resolved-config.json"));
    assert.equal(snapshots.length, 1);
    const snapshot = await readFile(
      join(paths.stateRoot(), snapshots[0]),
      "utf8",
    );
    assert.match(snapshot, /\[REDACTED\]/);
    assert.doesNotMatch(snapshot, /runtime-secret/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
