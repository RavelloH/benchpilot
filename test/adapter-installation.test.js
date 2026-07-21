import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AdapterRegistry, PathService, objectSchema } from "../dist/index.js";
import { AdapterConfigurationUseCases } from "../dist/application/adapters/configuration-use-case.js";
import { AdapterInstallationUseCases } from "../dist/application/adapters/installation-use-case.js";
import { resolveLatestEimAsset } from "../dist/adapters/runtime/esp-idf-installer.js";

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
