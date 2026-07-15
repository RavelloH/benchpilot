import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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

const template = join(process.cwd(), "src", "adapters", "_template");
const complete = join(
  process.cwd(),
  "test",
  "fixtures",
  "adapters",
  "complete",
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
    assert.deepEqual(Object.keys(first.bundle.platforms), [
      "windows",
      "linux",
      "macos",
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("bulk compilation excludes the template and writes an empty index", async () => {
  const output = await mkdtemp(join(tmpdir(), "benchpilot-adapter-output-"));
  try {
    const result = await compileAll(output);
    assert.deepEqual(result.diagnostics, []);
    assert.equal(await readFile(join(output, "index.json"), "utf8"), "[]\n");
    await assert.rejects(readFile(join(output, "template.json"), "utf8"));
  } finally {
    await rm(output, { recursive: true, force: true });
  }
});

test("complete adapter fixture validates and compiles", async () => {
  const validation = await validateAdapter(complete);
  assert.deepEqual(validation.diagnostics, []);
  const compiled = await compileAdapter(complete);
  assert.deepEqual(compiled.diagnostics, []);
  assert.equal(compiled.bundle.capabilityCatalog.version, 1);
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
