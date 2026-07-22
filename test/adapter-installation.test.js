import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  AdapterRegistry,
  BenchPilotError,
  PathService,
  objectSchema,
} from "../dist/index.js";
import { AdapterConfigurationUseCases } from "../dist/application/adapters/configuration-use-case.js";
import { AdapterInstallationUseCases } from "../dist/application/adapters/installation-use-case.js";
import { resolveLatestEimAsset } from "../dist/adapters/runtime/eim-installer.js";
import { EimInstallProgressParser } from "../dist/adapters/runtime/eim-installer.js";
import { parseEimTargets } from "../dist/adapters/runtime/eim-installer.js";
import { consumeEimOutputChunk } from "../dist/adapters/runtime/eim-installer.js";
import { eimToolDownloadMetadata } from "../dist/adapters/runtime/eim-installer.js";
import { isEimManagedUserPath } from "../dist/adapters/runtime/eim-installer.js";

test("EIM resolver uses the latest GitHub release metadata and its published digest", async () => {
  const digest = "a".repeat(64);
  const resolved = await resolveLatestEimAsset({
    platform: "windows",
    request: async () =>
      new Response(
        JSON.stringify({
          tag_name: "v9.9.9",
          assets: [
            {
              name: "eim-cli-windows-x64.exe",
              browser_download_url:
                "https://github.com/espressif/idf-im-ui/releases/download/v9.9.9/eim-cli-windows-x64.exe",
              digest: `sha256:${digest}`,
            },
          ],
        }),
        { status: 200 },
      ),
  });
  assert.equal(resolved.tag, "v9.9.9");
  assert.equal(resolved.digest, digest);
  assert.match(resolved.asset.browser_download_url, /v9\.9\.9/);
});

test("EIM resolver falls back to GitHub release HTML when the API is unavailable", async () => {
  const digest = "b".repeat(64);
  const calls = [];
  const request = async (url) => {
    calls.push(String(url));
    if (String(url).includes("api.github.com"))
      return { ok: false, status: 403 };
    if (String(url).endsWith("/releases/latest"))
      return {
        ok: true,
        status: 200,
        url: "https://github.com/espressif/idf-im-ui/releases/tag/v8.8.8",
      };
    return {
      ok: true,
      status: 200,
      text: async () =>
        `<a href="/espressif/idf-im-ui/releases/download/v8.8.8/eim-cli-linux-x64.zip">eim-cli-linux-x64.zip</a> sha256:${digest}`,
    };
  };
  const resolved = await resolveLatestEimAsset({
    platform: "linux",
    request,
  });
  assert.equal(resolved.tag, "v8.8.8");
  assert.equal(resolved.digest, digest);
  assert.equal(calls.length, 3);
});

test("EIM resolver falls back to GitHub release HTML when the API request fails", async () => {
  const digest = "c".repeat(64);
  const calls = [];
  const request = async (url) => {
    calls.push(String(url));
    if (String(url).includes("api.github.com"))
      throw Object.assign(new TypeError("fetch failed"), {
        cause: Object.assign(new Error("connect ETIMEDOUT"), {
          code: "ETIMEDOUT",
        }),
      });
    if (String(url).endsWith("/releases/latest"))
      return {
        ok: true,
        status: 200,
        url: "https://github.com/espressif/idf-im-ui/releases/tag/v7.7.7",
      };
    return {
      ok: true,
      status: 200,
      text: async () =>
        `<a href="/espressif/idf-im-ui/releases/download/v7.7.7/eim-cli-windows-x64.exe">eim-cli-windows-x64.exe</a> sha256:${digest}`,
    };
  };
  const resolved = await resolveLatestEimAsset({
    platform: "windows",
    request,
  });
  assert.equal(resolved.tag, "v7.7.7");
  assert.equal(resolved.digest, digest);
  assert.equal(calls.length, 3);
});

test("EIM progress parser exposes only measured tool counts, transfer bytes, and local percentages", () => {
  const parser = new EimInstallProgressParser();
  assert.deepEqual(
    parser.consume("Filtered to 14 tools based on user selection"),
    [
      {
        type: "adapter.install.toolchain",
        data: {
          state: "running",
          reentrant: true,
          transition: true,
          current: 0,
          total: 13,
          label: { key: "install.tools", fallback: "Installing ESP-IDF tools" },
        },
      },
    ],
  );
  assert.deepEqual(
    parser.consume("Tool 'xtensa-esp-elf' is not installed. Downloading..."),
    [
      {
        type: "adapter.install.download",
        data: {
          state: "running",
          reentrant: true,
          parentEvent: "adapter.install.toolchain",
          instance: "xtensa-esp-elf",
          tool: "xtensa-esp-elf",
          label: {
            key: "install.download",
            fallback: "Downloading xtensa-esp-elf",
            values: { tool: "xtensa-esp-elf" },
          },
        },
      },
    ],
  );
  const transfer = parser.consume("xtensa-esp-elf 50 MiB / 100 MiB");
  assert.equal(transfer[0].data.current, 50 * 1024 ** 2);
  assert.equal(transfer[0].data.total, 100 * 1024 ** 2);
  assert.equal(transfer[0].data.percent, 50);
  const extracted = parser.consume("Successfully extracted xtensa-esp-elf");
  assert.equal(extracted[0].data.state, "completed");
  assert.equal(extracted[1].data.current, 1);
  assert.equal(extracted[1].data.total, 13);
  assert.deepEqual(parser.consume("Python installed successfully"), []);
  assert.deepEqual(parser.consume("Component Registry synchronization"), []);
  const registry = parser.consume("registry 80%");
  assert.equal(registry[0].data.percent, 80);
});

test("EIM tool metadata resolves the platform archive with its published size", () => {
  assert.deepEqual(
    eimToolDownloadMetadata(
      {
        tools: [
          {
            name: "ninja",
            versions: [
              {
                win64: {
                  size: 1234,
                  url: "https://example.invalid/downloads/ninja.zip",
                },
              },
            ],
          },
        ],
      },
      "ninja",
      "win64",
    ),
    { fileName: "ninja.zip", total: 1234 },
  );
});

test("EIM user PATH cleanup recognizes a prior managed executable entry", () => {
  assert.equal(
    isEimManagedUserPath(
      "D:\\chips\\sdk\\esp-idf\\eim",
      "D:\\chips\\sdk\\esp-idf",
    ),
    true,
  );
  assert.equal(
    isEimManagedUserPath(
      "D:\\chips\\sdk\\esp-idf\\tools",
      "D:\\chips\\sdk\\esp-idf",
    ),
    false,
  );
});

test("EIM output splitter processes carriage-return progress frames and strips terminal escapes", () => {
  const first = consumeEimOutputChunk({
    buffered: "",
    chunk: Buffer.from(
      "\u001b[32mTool 'ninja' is not installed. Downloading\u001b[0m\r50 MiB / ",
    ),
  });
  assert.deepEqual(first.lines, ["Tool 'ninja' is not installed. Downloading"]);
  assert.equal(first.buffered, "50 MiB / ");
  const second = consumeEimOutputChunk({
    buffered: first.buffered,
    chunk: Buffer.from("100 MiB\r"),
  });
  assert.deepEqual(second.lines, ["50 MiB / 100 MiB"]);
  assert.equal(second.buffered, "");
});

test("ESP-IDF install targets use one comma-separated option and persist a unique list", () => {
  assert.deepEqual(
    parseEimTargets("esp32, esp32s3,esp32", ["esp32", "esp32s3"]),
    ["esp32", "esp32s3"],
  );
  assert.throws(
    () => parseEimTargets("esp32,not-a-chip", ["esp32"]),
    (error) =>
      error instanceof BenchPilotError &&
      error.kind === "ADAPTER_INSTALLATION_FAILED",
  );
});

test("installer persists only a verified adapter configuration in a temporary global root", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "benchpilot-adapter-install-"),
  );
  try {
    const paths = new PathService({}, process.platform, root);
    const registry = new AdapterRegistry();
    registry.register({
      id: "demo",
      apiVersion: 1,
      version: "1.0.0",
      summary: "Demo",
      configSchema: objectSchema(),
      async discover() {
        return [];
      },
      async doctor() {
        return [];
      },
      async createDevice() {
        return {};
      },
      installation() {
        return {
          platforms: ["windows", "linux", "macos"],
          stability: "stable",
          estimate: { minimumBytes: 1, maximumBytes: 2 },
          fields: [{ key: "target", summary: "Target", required: true }],
          async install({ root: installationRoot, values }) {
            return {
              configuration: {
                managed_root: installationRoot,
                target: values.target,
              },
            };
          },
        };
      },
    });
    const config = { value: {}, origins: new Map(), layers: [] };
    const configuration = new AdapterConfigurationUseCases({
      registry,
      paths,
      config,
    });
    const installed = await new AdapterInstallationUseCases({
      registry,
      paths,
      configuration,
      businessLogs: {
        open() {
          return {
            debug() {},
            info() {},
            warn() {},
            event() {},
            async close() {},
          };
        },
      },
    }).install("demo", { target: "demo-chip" });
    assert.equal(
      installed.root,
      path.join(root, ".benchpilot", "tools", "demo"),
    );
    assert.equal(installed.changed, true);
    const global = await readFile(paths.globalConfig(), "utf8");
    assert.match(global, /\[adapters.demo\]/);
    assert.match(global, /target = "demo-chip"/);
    assert.match(global, /managed_root =/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("discovery distinguishes a missing installation from a partially invalid one", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "benchpilot-adapter-discovery-"),
  );
  try {
    const registry = new AdapterRegistry();
    registry.register({
      id: "demo",
      apiVersion: 1,
      version: "1.0.0",
      summary: "Demo",
      configSchema: objectSchema(),
      async discover() {
        return [];
      },
      async doctor() {
        return [];
      },
      async createDevice() {
        return {};
      },
      async discoverConfiguration() {
        return {
          adapter: "demo",
          ready: false,
          config: {},
          tools: [
            { id: "python", required: true, status: "unavailable" },
            { id: "idf", required: true, status: "unavailable" },
          ],
        };
      },
      configurationNotFound() {
        return true;
      },
    });
    const useCases = new AdapterConfigurationUseCases({
      registry,
      paths: new PathService({}, process.platform, root),
      config: { value: {}, origins: new Map(), layers: [] },
    });
    await assert.rejects(
      useCases.discover("demo"),
      (error) =>
        error instanceof BenchPilotError &&
        error.kind === "ADAPTER_CONFIGURATION_NOT_FOUND",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
