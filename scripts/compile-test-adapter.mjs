import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { compileAdapter } from "../dist/adapters/compiler/compiler.js";
import { stable } from "../dist/core/utilities/stable-json.js";

const root = resolve("test", "fixtures", "adapters", "demo");
const output = resolve("test", ".adapter-bundles");
const result = await compileAdapter(root);
if (!result.bundle) throw new Error(JSON.stringify(result.diagnostics));
const bundle = result.bundle;
const staging = `${output}.staging-${process.pid}`;
await rm(staging, { recursive: true, force: true });
await mkdir(staging, { recursive: true });
await writeFile(resolve(staging, "demo.json"), `${stable(bundle)}\n`);
await writeFile(
  resolve(staging, "index.json"),
  `${stable([
    {
      id: bundle.id,
      displayName: bundle.manifest.display_name,
      adapterVersion: bundle.manifest.adapter_version,
      status: bundle.manifest.status,
      sourceHash: bundle.sourceHash,
      bundleSha256: bundle.bundleSha256,
      path: "demo.json",
      platforms: Object.fromEntries(
        Object.entries(bundle.platforms).map(([name, value]) => [
          name,
          Object.fromEntries(
            Object.entries(value.capabilities || {}).map(([id, capability]) => [
              id,
              Boolean(capability.enabled && capability.platforms?.[name]),
            ]),
          ),
        ]),
      ),
    },
  ])}\n`,
);
await rm(output, { recursive: true, force: true });
await rename(staging, output);
