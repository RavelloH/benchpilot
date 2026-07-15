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

const globalBooleanOptions = new Set([
  "json",
  "jsonl",
  "quiet",
  "verbose",
  "dry-run",
  "no-color",
  "help",
  "version",
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
    const [rawKey, inline] = token.slice(2).split("=", 2);
    const negated = rawKey.startsWith("no-");
    const key = negated ? rawKey.slice(3) : rawKey;
    if (negated) flags[key] = false;
    else if (inline !== undefined)
      flags[key] =
        inline === "true" ? true : inline === "false" ? false : inline;
    else if (globalBooleanOptions.has(key)) flags[key] = true;
    else {
      const next = argv[index + 1];
      if (next && !next.startsWith("--")) flags[key] = argv[++index]!;
      else flags[key] = true;
    }
  }
  if (flags.json && flags.jsonl)
    fail("USAGE_ERROR", 2, "--json and --jsonl cannot be used together.");
  return { path: positional, flags };
}
