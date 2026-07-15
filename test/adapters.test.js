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

const template = join(process.cwd(), "src", "adapters", "_template");
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
