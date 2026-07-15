import { readdir, stat } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import type { AdapterDiagnostic } from "./types.js";
import { diagnostic } from "./diagnostics.js";

export const fixedFiles = [
  "manifest.toml",
  "capabilities.toml",
  "tools.toml",
  "tool-discovery.toml",
  "environments.toml",
  "devices.toml",
  "actions.toml",
  "workflows.toml",
  "parsers.toml",
  "artifacts.toml",
  "schemas/config.schema.json",
  "schemas/device.schema.json",
  "schemas/inputs.schema.json",
  "schemas/outputs.schema.json",
  "platforms/windows.toml",
  "platforms/linux.toml",
  "platforms/macos.toml",
  "tests/cases.toml",
  "README.md",
];

const filesUnder = async (root: string): Promise<string[]> => {
  const entries = await readdir(root, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const full = resolve(root, entry.name);
      if (entry.isDirectory())
        return filesUnder(full).then((items) =>
          items.map((item) => `${entry.name}/${item}`),
        );
      return [entry.name];
    }),
  );
  return nested.flat();
};

const allowedExtra = (path: string) =>
  path.startsWith("tests/fixtures/") || path.startsWith("docs/");

export const validateAdapterLayout = async (
  root: string,
  adapterId?: string,
): Promise<AdapterDiagnostic[]> => {
  const diagnostics: AdapterDiagnostic[] = [];
  for (const file of fixedFiles)
    try {
      if (!(await stat(resolve(root, file))).isFile())
        diagnostics.push(
          diagnostic(
            "ADAPTER_LAYOUT_MISMATCH",
            file,
            `Required file is missing: ${file}`,
            undefined,
            adapterId,
          ),
        );
    } catch {
      diagnostics.push(
        diagnostic(
          "ADAPTER_LAYOUT_MISMATCH",
          file,
          `Required file is missing: ${file}`,
          undefined,
          adapterId,
        ),
      );
    }
  for (const file of await filesUnder(root))
    if (!fixedFiles.includes(file) && !allowedExtra(file))
      diagnostics.push(
        diagnostic(
          "ADAPTER_LAYOUT_MISMATCH",
          file,
          `Unexpected adapter file: ${file}`,
          undefined,
          adapterId,
        ),
      );
  return diagnostics;
};

export const ensureInside = (root: string, candidate: string) => {
  const path = resolve(root, candidate);
  return (
    relative(root, path) !== "" &&
    !relative(root, path).startsWith(`..${sep}`) &&
    !relative(root, path).startsWith("../")
  );
};
