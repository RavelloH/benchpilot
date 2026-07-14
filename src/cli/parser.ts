import { fail, type Json } from "../core.js";

export type Flags = Json & {
  json?: boolean;
  jsonl?: boolean;
  help?: boolean;
  config?: string;
  quiet?: boolean;
  verbose?: boolean;
  timeout?: string;
  [key: string]: unknown;
};

const booleanOptions = new Set([
  "json",
  "jsonl",
  "quiet",
  "verbose",
  "dry-run",
  "no-color",
  "help",
  "version",
  "all",
  "local",
  "project",
  "global",
  "show-origin",
  "save",
  "dangerously-reset-demo-state",
  "dangerously-burn-demo-fuse",
  "dangerously-clear-active-lock",
  "dangerously-remove-all-runs",
]);

export function parse(argv: string[]): { path: string[]; flags: Flags } {
  const flags: Flags = {};
  const positional: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]!;
    if (!token.startsWith("--")) {
      positional.push(token);
      continue;
    }
    const [key, inline] = token.slice(2).split("=", 2);
    if (booleanOptions.has(key)) flags[key] = true;
    else {
      const value = inline ?? argv[++index];
      if (!value || value.startsWith("--"))
        fail("USAGE_ERROR", 2, `Option --${key} requires a value.`);
      flags[key] = value;
    }
  }
  if (flags.json && flags.jsonl)
    fail("USAGE_ERROR", 2, "--json and --jsonl cannot be used together.");
  return { path: positional, flags };
}
