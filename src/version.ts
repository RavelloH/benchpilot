import { createRequire } from "node:module";

const metadata = createRequire(import.meta.url)("../package.json") as {
  version?: unknown;
};

if (typeof metadata.version !== "string" || !metadata.version)
  throw new Error("BenchPilot package metadata does not declare a version.");

/** Package version from the single authoritative package.json source. */
export const packageVersion = metadata.version;
