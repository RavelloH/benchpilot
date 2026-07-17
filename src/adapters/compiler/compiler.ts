import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { sha, stable } from "../../core/utilities/stable-json.js";
import { bundleSha256 } from "../contract/bundle.js";
import { diagnostic, hasErrors } from "./diagnostics.js";
import { validateAdapterLayout } from "./layout.js";
import { fixedFiles } from "./layout.js";
import { loadAdapter } from "./loader.js";
import { mergePlatform } from "../contract/platform.js";
import { validateBundle, validateSchemas } from "./schema-validator.js";
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
const sections = {
  tools: { file: "tools.toml", property: "tools" },
  discoveries: { file: "tool-discovery.toml", property: "discoveries" },
  environments: { file: "environments.toml", property: "environments" },
  devices: { file: "devices.toml", property: null },
  actions: { file: "actions.toml", property: "actions" },
  workflows: { file: "workflows.toml", property: "workflows" },
  parsers: { file: "parsers.toml", property: "parsers" },
  artifacts: { file: "artifacts.toml", property: "sets" },
} as const;
const sectionNames = Object.keys(sections) as Array<keyof typeof sections>;

export const validateAdapter = async (
  root: string,
  catalogPath = catalog,
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
  let adapter: LoadedAdapter;
  try {
    adapter = await loadAdapter(root);
  } catch (error) {
    return {
      adapter: { id: basename(root), root, files: {}, schemas: {} },
      diagnostics: [
        ...layout,
        diagnostic(
          "ADAPTER_SCHEMA_INVALID",
          "adapter",
          `Could not load adapter: ${(error as Error).message}`,
          undefined,
          basename(root) === "_template" ? "template" : basename(root),
        ),
      ],
    };
  }
  const diagnostics = [
    ...layout,
    ...(await validateSchemas(adapter, schemaRoot)),
    ...(await validateSemantics(adapter, catalogPath)),
  ];
  for (const platform of ["windows", "linux", "macos"]) {
    const platformFile = `platforms/${platform}.toml`;
    if (adapter.files[platformFile].platform !== platform)
      diagnostics.push({
        severity: "error",
        code: "ADAPTER_PLATFORM_OVERRIDE_INVALID",
        adapterId: adapter.id,
        file: platformFile,
        message: `Platform file must declare platform = ${platform}`,
      });
    const overlay = adapter.files[platformFile].overrides as JsonObject;
    for (const key of Object.keys(overlay))
      if (!sectionNames.includes(key as keyof typeof sections))
        diagnostics.push({
          severity: "error",
          code: "ADAPTER_PLATFORM_OVERRIDE_INVALID",
          adapterId: adapter.id,
          file: `platforms/${platform}.toml`,
          message: `Platform overlay cannot override ${key}`,
        });
    for (const [key, value] of Object.entries(overlay)) {
      if (!sectionNames.includes(key as keyof typeof sections)) continue;
      if (value && typeof value === "object" && !Array.isArray(value))
        for (const id of Object.keys(value as JsonObject)) {
          const section = sections[key as keyof typeof sections];
          const base = section.property
            ? adapter.files[section.file][section.property]
            : Object.fromEntries(
                Object.entries(adapter.files[section.file]).filter(
                  ([name]) => name !== "schema" && name !== "schema_version",
                ),
              );
          if (!Object.hasOwn((base ?? {}) as object, id))
            diagnostics.push({
              severity: "error",
              code: "ADAPTER_PLATFORM_OVERRIDE_INVALID",
              adapterId: adapter.id,
              file: `platforms/${platform}.toml`,
              message: `Platform overlay cannot introduce ${key} id ${id}`,
            });
        }
    }
    const platformFiles = { ...adapter.files };
    for (const [key, value] of Object.entries(overlay)) {
      if (!sectionNames.includes(key as keyof typeof sections)) continue;
      const section = sections[key as keyof typeof sections];
      if (section.property)
        platformFiles[section.file] = {
          ...platformFiles[section.file],
          [section.property]: mergePlatform(
            (platformFiles[section.file][section.property] ?? {}) as JsonObject,
            value as JsonObject,
          ),
        };
      else
        platformFiles[section.file] = mergePlatform(
          platformFiles[section.file],
          value as JsonObject,
        );
    }
    const mergedAdapter = { ...adapter, files: platformFiles };
    diagnostics.push(
      ...(await validateSchemas(mergedAdapter, schemaRoot)),
      ...(await validateSemantics(mergedAdapter, catalogPath)),
    );
  }
  return { adapter, diagnostics };
};

export const adapterRoots = async () =>
  [
    resolve(adaptersRoot, "_template"),
    ...(await readdir(resolve(adaptersRoot, "builtin"), { withFileTypes: true })
      .then((items) =>
        items
          .filter((item) => item.isDirectory())
          .map((item) => resolve(adaptersRoot, "builtin", item.name)),
      )
      .catch(() => [])),
  ].sort();

export const compileRoots = async () =>
  (await adapterRoots()).filter((root) => basename(root) !== "_template");

export const validateAllAdapters = async () => {
  const results = await Promise.all(
    (await adapterRoots()).map((root) => validateAdapter(root)),
  );
  return {
    diagnostics: results.flatMap((result) => result.diagnostics),
    results,
  };
};

export const compileAdapter = async (
  root: string,
  catalogPath = catalog,
): Promise<{
  bundle?: CompiledAdapterBundleV1;
  diagnostics: AdapterDiagnostic[];
}> => {
  const { adapter, diagnostics } = await validateAdapter(root, catalogPath);
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
      extensions: adapter.files["capabilities.toml"].extensions ?? {},
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
  const catalogContent = await readFile(catalogPath, "utf8");
  const capabilityCatalog = (await import("@iarna/toml")).parse(
    catalogContent,
  ) as JsonObject;
  const source = await Promise.all(
    fixedFiles
      .slice()
      .sort()
      .map(async (file) => [file, await readFile(resolve(root, file), "utf8")]),
  );
  const unsigned: Omit<CompiledAdapterBundleV1, "bundleSha256"> = {
    schema: "benchpilot.adapter-bundle",
    schemaVersion: 2,
    id: adapter.id,
    sourceHash: sha([source, catalogContent, 1]),
    manifest: adapter.files["manifest.toml"],
    capabilityCatalog,
    capabilityCatalogVersion: 1,
    capabilityCatalogHash: sha(catalogContent),
    schemas: adapter.schemas,
    platforms,
  };
  const bundle: CompiledAdapterBundleV1 = {
    ...unsigned,
    bundleSha256: bundleSha256(unsigned),
  };
  diagnostics.push(
    ...(await validateBundle(
      bundle as unknown as JsonObject,
      schemaRoot,
      adapter.id,
    )),
  );
  return hasErrors(diagnostics) ? { diagnostics } : { diagnostics, bundle };
};

export const compileAll = async (
  output = resolve("dist", "adapters", "bundles"),
) => {
  const roots = await compileRoots();
  const results = await Promise.all(roots.map((root) => compileAdapter(root)));
  const diagnostics = results.flatMap((item) => item.diagnostics);
  if (hasErrors(diagnostics)) return { diagnostics };
  const bundles = results
    .flatMap((item) => (item.bundle ? [item.bundle] : []))
    .sort((left, right) => left.id.localeCompare(right.id));
  const index = bundles.map((bundle) => ({
    id: bundle.id,
    displayName: bundle.manifest.display_name,
    adapterVersion: bundle.manifest.adapter_version,
    status: bundle.manifest.status,
    sourceHash: bundle.sourceHash,
    bundleSha256: bundle.bundleSha256,
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
  const outputRoot = resolve(output);
  const staging = `${outputRoot}.staging-${process.pid}-${Date.now()}`;
  const backup = `${outputRoot}.previous-${process.pid}-${Date.now()}`;
  await mkdir(dirname(outputRoot), { recursive: true });
  try {
    await mkdir(staging, { recursive: false });
    for (const bundle of bundles)
      await writeFile(
        resolve(staging, `${bundle.id}.json`),
        `${stable(bundle)}\n`,
      );
    await writeFile(resolve(staging, "index.json"), `${stable(index)}\n`);

    // Re-read what will be published: serialization and content hashes are a
    // release boundary, not merely an in-memory compiler invariant.
    for (const bundle of bundles) {
      const published = JSON.parse(
        await readFile(resolve(staging, `${bundle.id}.json`), "utf8"),
      ) as CompiledAdapterBundleV1;
      if (published.bundleSha256 !== bundleSha256(published))
        throw new Error(`Bundle hash validation failed for ${bundle.id}.`);
    }
    await rename(outputRoot, backup).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
    try {
      await rename(staging, outputRoot);
    } catch (error) {
      await rename(backup, outputRoot).catch(() => {});
      throw error;
    }
    await rm(backup, { recursive: true, force: true });
  } catch (error) {
    await rm(staging, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
  return { diagnostics };
};
