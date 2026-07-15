import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { sha, stable } from "../../core/utilities/stable-json.js";
import { hasErrors } from "./diagnostics.js";
import { validateAdapterLayout } from "./layout.js";
import { fixedFiles } from "./layout.js";
import { loadAdapter } from "./loader.js";
import { mergePlatform } from "./platform-merger.js";
import { validateSchemas } from "./schema-validator.js";
import { validateSemantics } from "./semantic-validator.js";
import type {
  AdapterDiagnostic,
  CompiledAdapterBundleV1,
  JsonObject,
  LoadedAdapter,
} from "./types.js";

export const adaptersRoot = resolve("src", "adapters");
const schemaRoot = resolve(adaptersRoot, "schema", "v1");
const catalog = resolve(adaptersRoot, "catalog", "capabilities.toml");
const baseNames = [
  "capabilities",
  "tools",
  "discoveries",
  "environments",
  "devices",
  "actions",
  "workflows",
  "parsers",
  "artifacts",
];
const fileFor = (name: string) =>
  name === "discoveries" ? "tool-discovery.toml" : `${name}.toml`;
const propertyFor = (name: string) =>
  name === "artifacts" ? "sets" : name === "devices" ? undefined : name;

export const validateAdapter = async (
  root: string,
): Promise<{ adapter: LoadedAdapter; diagnostics: AdapterDiagnostic[] }> => {
  const layout = await validateAdapterLayout(
    root,
    basename(root) === "_template" ? "template" : basename(root),
  );
  if (hasErrors(layout))
    return {
      adapter: { id: basename(root), root, files: {}, schemas: {} },
      diagnostics: layout,
    };
  const adapter = await loadAdapter(root);
  const diagnostics = [
    ...layout,
    ...(await validateSchemas(adapter, schemaRoot)),
    ...(await validateSemantics(adapter, catalog)),
  ];
  for (const platform of ["windows", "linux", "macos"]) {
    const overlay = adapter.files[`platforms/${platform}.toml`]
      .overrides as JsonObject;
    for (const key of Object.keys(overlay))
      if (!baseNames.includes(key))
        diagnostics.push({
          severity: "error",
          code: "ADAPTER_PLATFORM_OVERRIDE_INVALID",
          adapterId: adapter.id,
          file: `platforms/${platform}.toml`,
          message: `Platform overlay cannot override ${key}`,
        });
    for (const [key, value] of Object.entries(overlay))
      if (value && typeof value === "object" && !Array.isArray(value))
        for (const id of Object.keys(value as JsonObject)) {
          const baseFile = fileFor(key),
            baseKey = propertyFor(key);
          const base = baseKey
            ? adapter.files[baseFile][baseKey]
            : adapter.files[baseFile];
          if (!Object.hasOwn((base ?? {}) as object, id))
            diagnostics.push({
              severity: "error",
              code: "ADAPTER_PLATFORM_OVERRIDE_INVALID",
              adapterId: adapter.id,
              file: `platforms/${platform}.toml`,
              message: `Platform overlay cannot introduce ${key} id ${id}`,
            });
        }
    const platformFiles = { ...adapter.files };
    for (const [key, value] of Object.entries(overlay)) {
      const target = fileFor(key),
        property = propertyFor(key);
      if (!target || !property) continue;
      platformFiles[target] = {
        ...platformFiles[target],
        [property]: mergePlatform(
          (platformFiles[target][property] ?? {}) as JsonObject,
          value as JsonObject,
        ),
      };
    }
    const mergedAdapter = { ...adapter, files: platformFiles };
    diagnostics.push(
      ...(await validateSchemas(mergedAdapter, schemaRoot)),
      ...(await validateSemantics(mergedAdapter, catalog)),
    );
  }
  return { adapter, diagnostics };
};

export const adapterRoots = async () => [
  resolve(adaptersRoot, "_template"),
  ...(await readdir(resolve(adaptersRoot, "builtin"), { withFileTypes: true })
    .then((items) =>
      items
        .filter((item) => item.isDirectory())
        .map((item) => resolve(adaptersRoot, "builtin", item.name)),
    )
    .catch(() => [])),
];

export const validateAllAdapters = async () => {
  const results = await Promise.all(
    (await adapterRoots()).map(validateAdapter),
  );
  return {
    diagnostics: results.flatMap((result) => result.diagnostics),
    results,
  };
};

export const compileAdapter = async (
  root: string,
): Promise<{
  bundle?: CompiledAdapterBundleV1;
  diagnostics: AdapterDiagnostic[];
}> => {
  const { adapter, diagnostics } = await validateAdapter(root);
  if (hasErrors(diagnostics)) return { diagnostics };
  const platforms: Record<string, JsonObject> = {};
  for (const platform of ["windows", "linux", "macos"]) {
    const overlay = adapter.files[`platforms/${platform}.toml`]
      .overrides as JsonObject;
    const {
      schema: _schema,
      schema_version: _schemaVersion,
      ...deviceRules
    } = adapter.files["devices.toml"];
    const base = {
      capabilities: adapter.files["capabilities.toml"].capabilities,
      tools: adapter.files["tools.toml"].tools,
      discoveries: adapter.files["tool-discovery.toml"].discoveries,
      environments: adapter.files["environments.toml"].environments,
      devices: deviceRules,
      actions: adapter.files["actions.toml"].actions,
      workflows: adapter.files["workflows.toml"].workflows,
      parsers: adapter.files["parsers.toml"].parsers,
      artifacts: adapter.files["artifacts.toml"].sets,
    };
    platforms[platform] = mergePlatform(base, overlay);
  }
  const source = await Promise.all(
    fixedFiles
      .slice()
      .sort()
      .map(async (file) => [file, await readFile(resolve(root, file), "utf8")]),
  );
  return {
    diagnostics,
    bundle: {
      schema: "benchpilot.adapter-bundle",
      schemaVersion: 1,
      id: adapter.id,
      sourceHash: sha(source),
      manifest: adapter.files["manifest.toml"],
      capabilityCatalog: {},
      schemas: adapter.schemas,
      platforms,
    },
  };
};

export const compileAll = async (output = resolve("dist", "adapters")) => {
  const roots = await adapterRoots();
  const results = await Promise.all(roots.map(compileAdapter));
  const diagnostics = results.flatMap((item) => item.diagnostics);
  if (hasErrors(diagnostics)) return { diagnostics };
  await mkdir(output, { recursive: true });
  const bundles = results.flatMap((item) => (item.bundle ? [item.bundle] : []));
  await Promise.all(
    bundles.map((bundle) =>
      writeFile(resolve(output, `${bundle.id}.json`), `${stable(bundle)}\n`),
    ),
  );
  const index = bundles.map((bundle) => ({
    id: bundle.id,
    displayName: bundle.manifest.display_name,
    adapterVersion: bundle.manifest.adapter_version,
    status: bundle.manifest.status,
    sourceHash: bundle.sourceHash,
    path: `${bundle.id}.json`,
    platforms: Object.fromEntries(
      Object.entries(bundle.platforms).map(([name, item]) => [
        name,
        Object.fromEntries(
          Object.entries((item.capabilities ?? {}) as JsonObject).map(
            ([id, value]) => [
              id,
              Boolean(
                (value as JsonObject).enabled &&
                (value as JsonObject).platforms &&
                ((value as JsonObject).platforms as JsonObject)[name],
              ),
            ],
          ),
        ),
      ]),
    ),
  }));
  await writeFile(resolve(output, "index.json"), `${stable(index)}\n`);
  return { diagnostics };
};
