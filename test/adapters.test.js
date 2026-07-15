import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  compileAdapter,
  compileAll,
  validateAdapter,
} from "../dist/adapters/compiler/compiler.js";
import { mergePlatform } from "../dist/adapters/compiler/platform-merger.js";
import { runCases } from "../dist/adapters/compiler/case-runner.js";
import { loadAdapter } from "../dist/adapters/compiler/loader.js";
import { validateSemantics } from "../dist/adapters/compiler/semantic-validator.js";

const template = join(process.cwd(), "src", "adapters", "_template");
const complete = join(
  process.cwd(),
  "test",
  "fixtures",
  "adapters",
  "complete",
);
const invalid = join(process.cwd(), "test", "fixtures", "adapters", "invalid");
const catalog = join(
  process.cwd(),
  "src",
  "adapters",
  "catalog",
  "capabilities.toml",
);
const temporaryAdapter = async () => {
  const root = await mkdtemp(join(tmpdir(), "benchpilot-adapter-"));
  const adapterRoot = join(root, "template");
  await cp(template, adapterRoot, { recursive: true });
  return adapterRoot;
};

test("the adapter template validates and compiles deterministically", async () => {
  const root = await temporaryAdapter();
  try {
    const first = await compileAdapter(root);
    const second = await compileAdapter(root);
    assert.deepEqual(first.diagnostics, []);
    assert.equal(first.bundle.sourceHash, second.bundle.sourceHash);
    assert.equal(JSON.stringify(first.bundle), JSON.stringify(second.bundle));
    assert.deepEqual(Object.keys(first.bundle.platforms), [
      "windows",
      "linux",
      "macos",
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("catalog content contributes to bundle hashes without absolute paths", async () => {
  const root = await mkdtemp(join(tmpdir(), "benchpilot-catalog-"));
  try {
    const temporaryCatalog = join(root, "capabilities.toml");
    await writeFile(
      temporaryCatalog,
      `${await readFile(catalog, "utf8")}\n# temporary hash input\n`,
    );
    const original = await compileAdapter(complete);
    const changed = await compileAdapter(complete, temporaryCatalog);
    assert.deepEqual(original.diagnostics, []);
    assert.deepEqual(changed.diagnostics, []);
    assert.notEqual(original.bundle.sourceHash, changed.bundle.sourceHash);
    assert.notEqual(
      original.bundle.capabilityCatalogHash,
      changed.bundle.capabilityCatalogHash,
    );
    assert.equal(JSON.stringify(changed.bundle).includes(process.cwd()), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("bulk compilation excludes the template and writes an empty index", async () => {
  const output = await mkdtemp(join(tmpdir(), "benchpilot-adapter-output-"));
  try {
    await writeFile(join(output, "stale.json"), "stale\n");
    await writeFile(join(output, "keep.txt"), "keep\n");
    const result = await compileAll(output);
    assert.deepEqual(result.diagnostics, []);
    assert.equal(await readFile(join(output, "index.json"), "utf8"), "[]\n");
    await assert.rejects(readFile(join(output, "template.json"), "utf8"));
    await assert.rejects(readFile(join(output, "stale.json"), "utf8"));
    assert.equal(await readFile(join(output, "keep.txt"), "utf8"), "keep\n");
  } finally {
    await rm(output, { recursive: true, force: true });
  }
});

test("device discovery validates source, matcher, and probe references", async () => {
  const rules = [
    [
      "missing matcher source",
      `schema = "benchpilot.adapter.devices"\nschema_version = 1\n[discovery]\nenabled = true\n[[discovery.matchers]]\nid = "serial-present"\nsource = "missing"\nfield = "serial"\noperator = "exists"\nscore = 1\n[identity]\nfields = ["device.id"]\nallow_port_fallback = false\n`,
      "ADAPTER_REFERENCE_NOT_FOUND",
    ],
    [
      "duplicate source id",
      `schema = "benchpilot.adapter.devices"\nschema_version = 1\n[discovery]\nenabled = true\n[[discovery.sources]]\nid = "serial"\ntype = "serial"\n[[discovery.sources]]\nid = "serial"\ntype = "usb"\n[identity]\nfields = ["device.id"]\nallow_port_fallback = false\n`,
      "ADAPTER_SCHEMA_INVALID",
    ],
    [
      "duplicate matcher id",
      `schema = "benchpilot.adapter.devices"\nschema_version = 1\n[discovery]\nenabled = true\n[[discovery.sources]]\nid = "serial"\ntype = "serial"\n[[discovery.matchers]]\nid = "present"\nsource = "serial"\nfield = "serial"\noperator = "exists"\nscore = 1\n[[discovery.matchers]]\nid = "present"\nsource = "serial"\nfield = "serial"\noperator = "exists"\nscore = 2\n[identity]\nfields = ["device.id"]\nallow_port_fallback = false\n`,
      "ADAPTER_SCHEMA_INVALID",
    ],
    [
      "missing probe action",
      `schema = "benchpilot.adapter.devices"\nschema_version = 1\n[discovery]\nenabled = false\n[identity]\nfields = ["device.id"]\nallow_port_fallback = false\n[probe]\nenabled = true\naction = "missing"\nparser = "text"\nmay_reset_device = false\ndestructive = false\n`,
      "ADAPTER_REFERENCE_NOT_FOUND",
    ],
    [
      "missing probe parser",
      `schema = "benchpilot.adapter.devices"\nschema_version = 1\n[discovery]\nenabled = false\n[identity]\nfields = ["device.id"]\nallow_port_fallback = false\n[probe]\nenabled = true\naction = "run"\nparser = "missing"\nmay_reset_device = false\ndestructive = false\n`,
      "ADAPTER_REFERENCE_NOT_FOUND",
    ],
  ];
  for (const [name, devices, code] of rules) {
    const root = await mkdtemp(join(tmpdir(), "benchpilot-device-rules-"));
    const adapterRoot = join(root, "complete");
    try {
      await cp(complete, adapterRoot, { recursive: true });
      await writeFile(join(adapterRoot, "devices.toml"), devices);
      const result = await validateAdapter(adapterRoot);
      assert.ok(
        result.diagnostics.some(
          (item) => item.code === code && item.file === "devices.toml",
        ),
        name,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test("tool discovery probes reference declared parsers", async () => {
  const root = await mkdtemp(join(tmpdir(), "benchpilot-discovery-probe-"));
  const adapterRoot = join(root, "complete");
  try {
    await cp(complete, adapterRoot, { recursive: true });
    const discovery = await readFile(
      join(adapterRoot, "tool-discovery.toml"),
      "utf8",
    );
    await writeFile(
      join(adapterRoot, "tool-discovery.toml"),
      discovery.replace('parser = "text"', 'parser = "missing"'),
    );
    const result = await validateAdapter(adapterRoot);
    assert.ok(
      result.diagnostics.some(
        (item) =>
          item.code === "ADAPTER_REFERENCE_NOT_FOUND" &&
          item.file === "tool-discovery.toml",
      ),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("semantic discovery and device references are validated exactly once", async () => {
  const root = await mkdtemp(join(tmpdir(), "benchpilot-semantic-references-"));
  const adapterRoot = join(root, "complete");
  const deviceRules = ({
    source = "serial",
    action = "run",
    parser = "text",
  } = {}) =>
    `schema = "benchpilot.adapter.devices"\nschema_version = 1\n[discovery]\nenabled = true\n[[discovery.sources]]\nid = "serial"\ntype = "serial"\n[[discovery.matchers]]\nid = "serial-present"\nsource = "${source}"\nfield = "serial"\noperator = "exists"\nscore = 1\n[identity]\nfields = ["device.id"]\nallow_port_fallback = false\n[probe]\nenabled = true\naction = "${action}"\nparser = "${parser}"\nmay_reset_device = false\ndestructive = false\n`;
  const toolDiscoveries = (count, probe = "text") =>
    `schema = "benchpilot.adapter.tool-discovery"\nschema_version = 1\n${Array.from(
      { length: count },
      (_, index) =>
        `[discoveries.discovery-${index}]\nstrategy = "first-valid"\n[[discoveries.discovery-${index}.candidates]]\nid = "first"\ntype = "fixed"\npriority = 2\n[[discoveries.discovery-${index}.candidates]]\nid = "second"\ntype = "fixed"\npriority = 1\n[discoveries.discovery-${index}.validation]\npath_type = "file"\nexecutable = false\n[discoveries.discovery-${index}.probe]\nargs = []\nparser = "${probe}"\ntimeout = "1s"\n`,
    ).join("\n")}`;
  const messages = async () =>
    (await validateSemantics(await loadAdapter(adapterRoot), catalog)).map(
      (item) => item.message,
    );
  const assertOne = (items, message) =>
    assert.equal(items.filter((item) => item === message).length, 1, message);
  try {
    await cp(complete, adapterRoot, { recursive: true });

    await writeFile(
      join(adapterRoot, "tool-discovery.toml"),
      'schema = "benchpilot.adapter.tool-discovery"\nschema_version = 1\n[discoveries]\n',
    );
    await writeFile(
      join(adapterRoot, "devices.toml"),
      deviceRules({ source: "missing" }),
    );
    assertOne(
      await messages(),
      "Matcher serial-present source reference does not exist: missing",
    );

    await writeFile(
      join(adapterRoot, "tool-discovery.toml"),
      toolDiscoveries(1, "missing"),
    );
    await writeFile(join(adapterRoot, "devices.toml"), deviceRules());
    assertOne(
      await messages(),
      "Discovery discovery-0 probe parser reference does not exist: missing",
    );

    await writeFile(
      join(adapterRoot, "tool-discovery.toml"),
      toolDiscoveries(2),
    );
    await writeFile(
      join(adapterRoot, "devices.toml"),
      deviceRules({ source: "missing" }),
    );
    assertOne(
      await messages(),
      "Matcher serial-present source reference does not exist: missing",
    );

    await writeFile(
      join(adapterRoot, "devices.toml"),
      deviceRules({ action: "missing-action", parser: "missing-parser" }),
    );
    const probeMessages = await messages();
    assertOne(
      probeMessages,
      "Device probe action reference does not exist: missing-action",
    );
    assertOne(
      probeMessages,
      "Device probe parser reference does not exist: missing-parser",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("JSON Pointer extracts share strict cast handling with regex extracts", async () => {
  const root = await mkdtemp(join(tmpdir(), "benchpilot-parser-casts-"));
  const adapterRoot = join(root, "complete");
  const parser = (required) =>
    `schema = "benchpilot.adapter.parsers"\nschema_version = 1\n[parsers.json]\nmode = "json"\nencoding = "utf8"\nstrip_ansi = false\nsuccess_exit_codes = [0]\n[[parsers.json.extract]]\nid = "integer"\nsource = "stdout"\ntype = "json-pointer"\npointer = "/integer"\ntarget = "integer"\ncast = "integer"\nrequired = true\n[[parsers.json.extract]]\nid = "number"\nsource = "stdout"\ntype = "json-pointer"\npointer = "/number"\ntarget = "number"\ncast = "number"\nrequired = true\n[[parsers.json.extract]]\nid = "boolean"\nsource = "stdout"\ntype = "json-pointer"\npointer = "/boolean"\ntarget = "boolean"\ncast = "boolean"\nrequired = true\n[[parsers.json.extract]]\nid = "payload"\nsource = "stdout"\ntype = "json-pointer"\npointer = "/payload"\ntarget = "payload"\ncast = "json"\nrequired = true\n[[parsers.json.extract]]\nid = "bad-integer"\nsource = "stdout"\ntype = "json-pointer"\npointer = "/badInteger"\ntarget = "badInteger"\ncast = "integer"\nrequired = ${required}\n[[parsers.json.extract]]\nid = "bad-boolean"\nsource = "stdout"\ntype = "json-pointer"\npointer = "/badBoolean"\ntarget = "badBoolean"\ncast = "boolean"\nrequired = false\n`;
  try {
    await cp(complete, adapterRoot, { recursive: true });
    await writeFile(join(adapterRoot, "parsers.toml"), parser(true));
    await writeFile(
      join(adapterRoot, "tests", "cases.toml"),
      `schema = "benchpilot.adapter.cases"\nschema_version = 1\n[[cases]]\nid = "parse-json"\ntype = "parse-output"\nplatform = "linux"\ntarget = "json"\nstdout_fixture = "fixtures/output.json"\nexit_code = 0\n[cases.context]\n[cases.expect]\nsuccess = true\nresult = { integer = 3, number = 1.5, boolean = false, payload = { key = "value" } }\n`,
    );
    await writeFile(
      join(adapterRoot, "tests", "fixtures", "output.json"),
      '{"integer":"3","number":"1.5","boolean":"false","payload":{"key":"value"},"badInteger":"no","badBoolean":"no"}',
    );
    let errors = await runCases(await loadAdapter(adapterRoot));
    assert.ok(errors.some((item) => item.message.includes("bad-integer")));
    await writeFile(join(adapterRoot, "parsers.toml"), parser(false));
    errors = await runCases(await loadAdapter(adapterRoot));
    assert.deepEqual(errors, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("artifact plans preserve path and glob entries and reject unsafe paths", async () => {
  const root = await mkdtemp(join(tmpdir(), "benchpilot-artifact-plan-"));
  const adapterRoot = join(root, "complete");
  try {
    await cp(complete, adapterRoot, { recursive: true });
    const unsafeEntries = [
      { base: "../escape", path: "file.txt", glob: "*.log" },
      { base: "/absolute", path: "file.txt", glob: "*.log" },
      { base: "C:\\\\absolute", path: "file.txt", glob: "*.log" },
      { base: "\\\\server\\\\share", path: "file.txt", glob: "*.log" },
      { base: "project", path: "../escape", glob: "*.log" },
      { base: "project", path: "file.txt", glob: "/absolute" },
      { base: "project", path: "file.txt", glob: "C:\\\\absolute" },
      { base: "project", path: "file.txt", glob: "\\\\server\\\\share" },
    ];
    for (const { base, path, glob } of unsafeEntries) {
      await writeFile(
        join(adapterRoot, "artifacts.toml"),
        `schema = "benchpilot.adapter.artifacts"\nschema_version = 1\n[sets.output]\nbase = '${base}'\nentries = [{ id = "path", kind = "metadata", path = '${path}', required = false, multiple = false }, { id = "glob", kind = "log", glob = '${glob}', required = false, multiple = true }]\n`,
      );
      const errors = await runCases(await loadAdapter(adapterRoot));
      assert.ok(
        errors.some((item) =>
          item.message.includes("escapes its base directory"),
        ),
        base,
      );
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("complete adapter fixture validates, compiles, and exercises all case types", async () => {
  const validation = await validateAdapter(complete);
  assert.deepEqual(validation.diagnostics, []);
  assert.deepEqual(
    await validateSemantics(await loadAdapter(complete), catalog),
    [],
  );
  const compiled = await compileAdapter(complete);
  assert.deepEqual(compiled.diagnostics, []);
  assert.equal(compiled.bundle.capabilityCatalog.version, 1);
  assert.equal(
    compiled.bundle.platforms.windows.actions.run.cwd,
    "windows-project",
  );
  assert.deepEqual(
    compiled.bundle.platforms.macos.tools.python.launch.prefix_args,
    ["-E"],
  );
  assert.equal(
    compiled.bundle.platforms.linux.tools.python.launch.environment,
    "active",
  );
  assert.deepEqual(await runCases(validation.adapter), []);
});

test("invalid declaration fixtures report stable diagnostics", async () => {
  const fixtureNames = [
    "unknown-action-field",
    "invalid-tool-launch",
    "invalid-discovery-candidate",
    "invalid-environment-provider",
    "invalid-parser-rule",
    "unsafe-platform-capability-override",
    "invalid-json-schema",
    "invalid-case",
  ];
  for (const name of fixtureNames) {
    const mutation = JSON.parse(
      await readFile(join(invalid, name, "mutation.json"), "utf8"),
    );
    const root = await mkdtemp(join(tmpdir(), "benchpilot-invalid-adapter-"));
    const adapterRoot = join(root, "adapter");
    try {
      await cp(complete, adapterRoot, { recursive: true });
      const file = join(adapterRoot, mutation.file);
      const source = await readFile(file, "utf8");
      assert.notEqual(source.indexOf(mutation.search), -1, name);
      await writeFile(file, source.replace(mutation.search, mutation.replace));
      const result = await validateAdapter(adapterRoot);
      assert.ok(
        result.diagnostics.some((item) => item.code === mutation.code),
        name,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test("template compilation boundary fixture requires an empty builtin index", async () => {
  const fixture = JSON.parse(
    await readFile(
      join(invalid, "template-compiled-as-adapter", "mutation.json"),
      "utf8",
    ),
  );
  const output = await mkdtemp(join(tmpdir(), "benchpilot-adapter-output-"));
  try {
    const result = await compileAll(output);
    assert.deepEqual(result.diagnostics, []);
    assert.equal(
      await readFile(join(output, "index.json"), "utf8"),
      fixture.index,
    );
    await assert.rejects(readFile(join(output, fixture.absent), "utf8"));
  } finally {
    await rm(output, { recursive: true, force: true });
  }
});

test("layout validation rejects missing and unexpected rule files", async () => {
  const root = await temporaryAdapter();
  try {
    await rm(join(root, "actions.toml"));
    await writeFile(join(root, "runtime.toml"), "unexpected = true\n");
    const result = await validateAdapter(root);
    assert.deepEqual(
      new Set(result.diagnostics.map((item) => item.code)),
      new Set(["ADAPTER_LAYOUT_MISMATCH"]),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("platform merge recursively merges objects and replaces arrays", () => {
  assert.deepEqual(
    mergePlatform(
      { one: { two: 1 }, values: [1] },
      { one: { three: 2 }, values: [2] },
    ),
    { one: { two: 1, three: 2 }, values: [2] },
  );
});

test("semantic validation rejects invalid parser regular expressions", async () => {
  const root = await temporaryAdapter();
  try {
    const parsers = await readFile(join(root, "parsers.toml"), "utf8");
    await writeFile(
      join(root, "parsers.toml"),
      `${parsers}\n[parsers.bad]\nsuccess_exit_codes = [0]\n[[parsers.bad.errors]]\npattern = "["\n`,
    );
    const result = await validateAdapter(root);
    assert.ok(
      result.diagnostics.some((item) => item.code === "ADAPTER_REGEX_INVALID"),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("semantic validation requires a reason for partial platform support", async () => {
  const root = await temporaryAdapter();
  try {
    const capabilities = await readFile(
      join(root, "capabilities.toml"),
      "utf8",
    );
    await writeFile(
      join(root, "capabilities.toml"),
      capabilities
        .replace(
          "enabled = false",
          'enabled = true\nhandler = "action:missing"',
        )
        .replace("windows = false", "windows = true"),
    );
    const result = await validateAdapter(root);
    assert.ok(
      result.diagnostics.some(
        (item) => item.code === "ADAPTER_CAPABILITY_INVALID",
      ),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("template validation rejects fields excluded by adapter schemas", async () => {
  const root = await temporaryAdapter();
  try {
    const actions = await readFile(join(root, "actions.toml"), "utf8");
    await writeFile(
      join(root, "actions.toml"),
      `${actions}\n[actions.bad]\ntype = "copy"\nfrom = "${"${config.unknown}"}"\nto = "output"\n`,
    );
    const result = await validateAdapter(root);
    assert.ok(
      result.diagnostics.some(
        (item) => item.code === "ADAPTER_TEMPLATE_INVALID",
      ),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("render-action cases expand repeat arguments", async () => {
  const root = await temporaryAdapter();
  try {
    await writeFile(
      join(root, "actions.toml"),
      `schema = "benchpilot.adapter.actions"\nschema_version = 1\n\n[actions.run]\ntype = "process"\ntool = "tool"\ncwd = "${"${device.project}"}"\narguments = [{ kind = "repeat", values = "${"${input.values}"}", prefix = "--tag" }]\n`,
    );
    await writeFile(
      join(root, "tests", "cases.toml"),
      `schema = "benchpilot.adapter.cases"\nschema_version = 1\n\n[[cases]]\nid = "repeat"\ntype = "render-action"\nplatform = "linux"\ntarget = "run"\n[cases.context.device]\nproject = "project"\n[cases.context.input]\nvalues = ["one", "two"]\n[cases.expect]\ntool = "tool"\ncwd = "project"\nargs = ["--tag", "one", "--tag", "two"]\n`,
    );
    assert.deepEqual(await runCases(await loadAdapter(root)), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("platform overlays cannot override capability definitions", async () => {
  const root = await temporaryAdapter();
  try {
    await writeFile(
      join(root, "platforms", "windows.toml"),
      `schema = "benchpilot.adapter.platform"\nschema_version = 1\nplatform = "windows"\n[overrides.capabilities.build]\nenabled = true\n`,
    );
    const result = await validateAdapter(root);
    assert.ok(
      result.diagnostics.some(
        (item) =>
          item.code === "ADAPTER_SCHEMA_INVALID" ||
          item.code === "ADAPTER_PLATFORM_OVERRIDE_INVALID",
      ),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("embedded adapter schemas must compile", async () => {
  const root = await temporaryAdapter();
  try {
    await writeFile(
      join(root, "schemas", "inputs.schema.json"),
      JSON.stringify({
        $schema: "https://json-schema.org/draft/2020-12/schema",
        type: "object",
        $defs: { bad: { $ref: "#/missing" } },
      }),
    );
    const result = await validateAdapter(root);
    assert.ok(
      result.diagnostics.some(
        (item) =>
          item.code === "ADAPTER_SCHEMA_INVALID" &&
          item.file === "schemas/inputs.schema.json",
      ),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("adapter schema definitions resolve through their complete root schema", async () => {
  const validSchemas = [
    {
      $defs: {
        common: { type: "object", properties: { port: { type: "string" } } },
        flash: { $ref: "#/$defs/common" },
      },
    },
    {
      $defs: {
        common: { type: "object" },
        middle: { $ref: "#/$defs/common" },
        flash: { $ref: "#/$defs/middle" },
      },
    },
    {
      $defs: {
        node: {
          type: "object",
          properties: { child: { $ref: "#/$defs/node" } },
        },
      },
    },
    {
      $defs: {
        "common/a~b": { type: "object" },
        flash: { $ref: "#/$defs/common~1a~0b" },
      },
    },
  ];
  for (const schema of validSchemas) {
    const root = await temporaryAdapter();
    try {
      await writeFile(
        join(root, "schemas", "inputs.schema.json"),
        JSON.stringify({
          $schema: "https://json-schema.org/draft/2020-12/schema",
          type: "object",
          ...schema,
        }),
      );
      assert.deepEqual((await validateAdapter(root)).diagnostics, []);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
  const root = await temporaryAdapter();
  try {
    await writeFile(
      join(root, "schemas", "inputs.schema.json"),
      JSON.stringify({
        $schema: "https://json-schema.org/draft/2020-12/schema",
        type: "object",
        $defs: { flash: { $ref: "#/$defs/missing" } },
      }),
    );
    assert.ok(
      (await validateAdapter(root)).diagnostics.some(
        (item) =>
          item.code === "ADAPTER_SCHEMA_INVALID" &&
          item.file === "schemas/inputs.schema.json",
      ),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("adapter data schemas reject invalid roots, metaschemas, extensions, and properties", async () => {
  const invalidSchemas = [
    { type: "array", $defs: {} },
    {
      $schema: "https://example.invalid/not-a-json-schema",
      type: "object",
      $defs: {},
    },
    {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
    },
    {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      properties: "invalid",
      $defs: {},
    },
    {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      properties: {
        value: {
          "x-benchpilot-cli": { flag: 1 },
        },
      },
      $defs: {},
    },
    {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      properties: {
        value: {
          "x-benchpilot-cli": { secret: "yes" },
        },
      },
      $defs: {},
    },
    {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      properties: { constructor: { type: "string" } },
      $defs: {},
    },
  ];
  for (const schema of invalidSchemas) {
    const root = await temporaryAdapter();
    try {
      await writeFile(
        join(root, "schemas", "inputs.schema.json"),
        JSON.stringify(schema),
      );
      const result = await validateAdapter(root);
      assert.ok(
        result.diagnostics.some(
          (item) =>
            item.code === "ADAPTER_SCHEMA_INVALID" &&
            item.file === "schemas/inputs.schema.json",
        ),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test("enabled capabilities require input and output schemas", async () => {
  const root = await mkdtemp(join(tmpdir(), "benchpilot-adapter-"));
  const adapterRoot = join(root, "complete");
  try {
    await cp(complete, adapterRoot, { recursive: true });
    const capabilities = await readFile(
      join(adapterRoot, "capabilities.toml"),
      "utf8",
    );
    await writeFile(
      join(adapterRoot, "capabilities.toml"),
      capabilities
        .replace('input_schema = "build"\n', "")
        .replace('output_schema = "build"\n', ""),
    );
    const result = await validateAdapter(adapterRoot);
    assert.ok(
      result.diagnostics.some((item) => item.code === "ADAPTER_SCHEMA_INVALID"),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("parser regex extracts require an existing named group", async () => {
  const root = await temporaryAdapter();
  try {
    await writeFile(
      join(root, "parsers.toml"),
      `schema = "benchpilot.adapter.parsers"\nschema_version = 1\n[parsers.bad]\nmode = "line"\nencoding = "utf8"\nstrip_ansi = true\nsuccess_exit_codes = [0]\n[[parsers.bad.extract]]\nid = "value"\nsource = "stdout"\ntype = "regex"\npattern = "(?<actual>value)"\ntarget = "value"\ngroup = "missing"\ncast = "string"\nrequired = true\n`,
    );
    const result = await validateAdapter(root);
    assert.ok(
      result.diagnostics.some((item) => item.code === "ADAPTER_REGEX_INVALID"),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("device overlays merge into the final platform bundle", async () => {
  const root = await temporaryAdapter();
  try {
    await writeFile(
      join(root, "platforms", "windows.toml"),
      `schema = "benchpilot.adapter.platform"\nschema_version = 1\nplatform = "windows"\n[overrides.devices.identity]\nfields = ["device.serial"]\nallow_port_fallback = false\n`,
    );
    const result = await compileAdapter(root);
    assert.deepEqual(result.diagnostics, []);
    assert.deepEqual(result.bundle.platforms.windows.devices.identity.fields, [
      "device.serial",
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("platform overlays reject new rule IDs and forbidden roots", async () => {
  const root = await temporaryAdapter();
  try {
    await writeFile(
      join(root, "platforms", "windows.toml"),
      `schema = "benchpilot.adapter.platform"\nschema_version = 1\nplatform = "windows"\n[overrides.actions.new]\ncwd = "project"\n`,
    );
    const newId = await validateAdapter(root);
    assert.ok(
      newId.diagnostics.some(
        (item) => item.code === "ADAPTER_PLATFORM_OVERRIDE_INVALID",
      ),
    );
    await writeFile(
      join(root, "platforms", "windows.toml"),
      `schema = "benchpilot.adapter.platform"\nschema_version = 1\nplatform = "windows"\n[overrides.manifest]\nid = "forbidden"\n`,
    );
    const forbidden = await validateAdapter(root);
    assert.ok(
      forbidden.diagnostics.some(
        (item) => item.code === "ADAPTER_SCHEMA_INVALID",
      ),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("platform filenames and platform declarations must agree", async () => {
  const root = await temporaryAdapter();
  try {
    await writeFile(
      join(root, "platforms", "windows.toml"),
      `schema = "benchpilot.adapter.platform"\nschema_version = 1\nplatform = "linux"\n[overrides]\n`,
    );
    const result = await validateAdapter(root);
    assert.ok(
      result.diagnostics.some(
        (item) => item.code === "ADAPTER_PLATFORM_OVERRIDE_INVALID",
      ),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("tool launch modes reject command and tool together", async () => {
  const root = await temporaryAdapter();
  try {
    await writeFile(
      join(root, "tools.toml"),
      `schema = "benchpilot.adapter.tools"\nschema_version = 1\n[tools.bad]\ndescription = "Bad"\nrequired = true\ndiscovery = "missing"\n[tools.bad.launch]\nmode = "direct"\ncommand = "tool"\ntool = "other"\nprefix_args = []\nenvironment = "inherit"\n`,
    );
    const result = await validateAdapter(root);
    assert.ok(
      result.diagnostics.some(
        (item) =>
          item.code === "ADAPTER_SCHEMA_INVALID" && item.file === "tools.toml",
      ),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("action schemas reject unknown fields", async () => {
  const root = await temporaryAdapter();
  try {
    await writeFile(
      join(root, "actions.toml"),
      `schema = "benchpilot.adapter.actions"\nschema_version = 1\n[actions.bad]\ntype = "copy"\nfrom = "a"\nto = "b"\nrecursive = true\noverwrite = true\nshell = true\n`,
    );
    const result = await validateAdapter(root);
    assert.ok(
      result.diagnostics.some(
        (item) =>
          item.code === "ADAPTER_SCHEMA_INVALID" &&
          item.file === "actions.toml",
      ),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("workflow schemas allow action steps only", async () => {
  const root = await temporaryAdapter();
  try {
    await writeFile(
      join(root, "workflows.toml"),
      `schema = "benchpilot.adapter.workflows"\nschema_version = 1\n[workflows.bad]\ntimeout = "1m"\nstop_on_failure = true\n[[workflows.bad.steps]]\nid = "nested"\nuses = "workflow:other"\n`,
    );
    const result = await validateAdapter(root);
    assert.ok(
      result.diagnostics.some(
        (item) =>
          item.code === "ADAPTER_SCHEMA_INVALID" &&
          item.file === "workflows.toml",
      ),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("environment providers require their type-specific fields", async () => {
  const root = await temporaryAdapter();
  try {
    await writeFile(
      join(root, "environments.toml"),
      `schema = "benchpilot.adapter.environments"\nschema_version = 1\n[environments.bad]\nstrategy = "first-valid"\n[[environments.bad.providers]]\nid = "static"\ntype = "static"\npriority = 1\n`,
    );
    const result = await validateAdapter(root);
    assert.ok(
      result.diagnostics.some(
        (item) =>
          item.code === "ADAPTER_SCHEMA_INVALID" &&
          item.file === "environments.toml",
      ),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("active environment providers require a string array", async () => {
  const root = await mkdtemp(join(tmpdir(), "benchpilot-active-environment-"));
  const adapterRoot = join(root, "complete");
  try {
    await cp(complete, adapterRoot, { recursive: true });
    const environments = await readFile(
      join(adapterRoot, "environments.toml"),
      "utf8",
    );
    await writeFile(
      join(adapterRoot, "environments.toml"),
      environments.replace(
        'required_variables = ["PATH"]',
        'required_variables = "PATH"',
      ),
    );
    assert.ok(
      (await validateAdapter(adapterRoot)).diagnostics.some(
        (item) =>
          item.code === "ADAPTER_SCHEMA_INVALID" &&
          item.file === "environments.toml",
      ),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

const runAdapterTestCli = async (mutate) => {
  const root = await mkdtemp(join(tmpdir(), "benchpilot-adapter-cli-"));
  try {
    const adapterRoot = join(root, "src", "adapters");
    await mkdir(join(root, "src"), { recursive: true });
    await cp(join(process.cwd(), "src", "adapters"), adapterRoot, {
      recursive: true,
    });
    await mutate(join(adapterRoot, "_template"));
    const output = await new Promise((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [join(process.cwd(), "dist", "adapters", "compiler", "cli.js"), "test"],
        { cwd: root },
      );
      let stdout = "",
        stderr = "";
      child.stdout.on("data", (chunk) => (stdout += chunk));
      child.stderr.on("data", (chunk) => (stderr += chunk));
      child.on("error", reject);
      child.on("close", (code) => resolve({ code, stdout, stderr }));
    });
    assert.notEqual(output.code, 0);
    const result = JSON.parse(output.stdout);
    assert.equal(result.ok, false);
    assert.ok(Array.isArray(result.diagnostics));
    assert.doesNotMatch(output.stderr, /(?:TypeError|Unhandled|^\s*at )/m);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
};

test("adapter:test keeps malformed declarations in its JSON protocol", async () => {
  await runAdapterTestCli((root) => rm(join(root, "actions.toml")));
  await runAdapterTestCli((root) => rm(join(root, "tests", "cases.toml")));
  await runAdapterTestCli((root) =>
    writeFile(join(root, "actions.toml"), "[actions"),
  );
  await runAdapterTestCli((root) =>
    writeFile(join(root, "schemas", "inputs.schema.json"), "{"),
  );
});

test("parser rules require non-empty patterns", async () => {
  const root = await temporaryAdapter();
  try {
    await writeFile(
      join(root, "parsers.toml"),
      `schema = "benchpilot.adapter.parsers"\nschema_version = 1\n[parsers.bad]\nmode = "line"\nencoding = "utf8"\nstrip_ansi = true\nsuccess_exit_codes = [0]\n[[parsers.bad.errors]]\nid = "bad"\npriority = 1\nsource = "stderr"\nkind = "BAD"\nretryable = false\nrecovery = []\n`,
    );
    const result = await validateAdapter(root);
    assert.ok(
      result.diagnostics.some(
        (item) =>
          item.code === "ADAPTER_SCHEMA_INVALID" &&
          item.file === "parsers.toml",
      ),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("device probes require an explicit disabled reason", async () => {
  const root = await temporaryAdapter();
  try {
    const devices = await readFile(join(root, "devices.toml"), "utf8");
    await writeFile(
      join(root, "devices.toml"),
      `${devices}\n[probe]\nenabled = false\n`,
    );
    const result = await validateAdapter(root);
    assert.ok(
      result.diagnostics.some(
        (item) =>
          item.code === "ADAPTER_SCHEMA_INVALID" &&
          item.file === "devices.toml",
      ),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("discovery candidates require their type-specific fields", async () => {
  const root = await temporaryAdapter();
  try {
    await writeFile(
      join(root, "tool-discovery.toml"),
      `schema = "benchpilot.adapter.tool-discovery"\nschema_version = 1\n[discoveries.bad]\nstrategy = "first-valid"\n[[discoveries.bad.candidates]]\nid = "path"\ntype = "path"\npriority = 1\n[discoveries.bad.validation]\npath_type = "file"\nexecutable = true\n`,
    );
    const result = await validateAdapter(root);
    assert.ok(
      result.diagnostics.some(
        (item) =>
          item.code === "ADAPTER_SCHEMA_INVALID" &&
          item.file === "tool-discovery.toml",
      ),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("disabled capabilities cannot enable a platform", async () => {
  const root = await temporaryAdapter();
  try {
    const capabilities = await readFile(
      join(root, "capabilities.toml"),
      "utf8",
    );
    await writeFile(
      join(root, "capabilities.toml"),
      capabilities.replace("windows = false", "windows = true"),
    );
    const result = await validateAdapter(root);
    assert.ok(
      result.diagnostics.some(
        (item) =>
          item.code === "ADAPTER_SCHEMA_INVALID" &&
          item.file === "capabilities.toml",
      ),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
