import { fail, type Json } from "../core.js";
import type { RawOption } from "./option-parser.js";

export type Flags = Json & {
  json?: boolean;
  jsonl?: boolean;
  help?: boolean;
  config?: string;
  quiet?: boolean;
  verbose?: boolean;
  timeout?: string;
  color?: boolean;
  [key: string]: unknown;
};

const globalBooleanOptions = new Set([
  "json",
  "jsonl",
  "quiet",
  "verbose",
  "dry-run",
  "agent",
  "color",
  "help",
  "version",
]);
const globalValueOptions = new Set(["config", "timeout", "session"]);

export function parse(argv: string[]): {
  path: string[];
  flags: Flags;
  rawOptions: RawOption[];
} {
  const flags: Flags = {};
  const positional: string[] = [];
  const rawOptions: RawOption[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]!;
    if (token === "--") {
      positional.push(...argv.slice(index + 1));
      break;
    }
    if (!token.startsWith("-") || token === "-") {
      positional.push(token);
      continue;
    }
    const long = token.startsWith("--");
    const [rawKey, inline] = token.slice(long ? 2 : 1).split("=", 2);
    const negated = long && rawKey.startsWith("no-");
    const key = negated ? rawKey.slice(3) : rawKey;
    if (globalBooleanOptions.has(key) || globalValueOptions.has(key)) {
      if (negated) flags[key] = false;
      else if (inline !== undefined)
        flags[key] =
          inline === "true" ? true : inline === "false" ? false : inline;
      else if (globalBooleanOptions.has(key)) flags[key] = true;
      else {
        const next = argv[index + 1];
        if (!next || next.startsWith("-"))
          fail("USAGE_ERROR", 2, `--${key} requires a value.`);
        flags[key] = argv[++index]!;
      }
      continue;
    }
    if (negated) rawOptions.push({ name: key, negated: true });
    else if (inline !== undefined)
      rawOptions.push({ name: key, value: inline });
    else {
      const next = argv[index + 1];
      if (next && !next.startsWith("-"))
        rawOptions.push({ name: key, value: argv[++index]! });
      else rawOptions.push({ name: key });
    }
  }
  if (flags.json && flags.jsonl)
    fail("USAGE_ERROR", 2, "--json and --jsonl cannot be used together.");
  return { path: positional, flags, rawOptions };
}
