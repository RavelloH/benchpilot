import { stdout } from "node:process";
import type { Json } from "../core.js";
import type { Flags } from "./parser.js";

export function write(value: unknown, flags: Flags, plain?: string) {
  const operation =
    value &&
    typeof value === "object" &&
    (value as Json).schema === "benchpilot.result";
  stdout.write(
    flags.json
      ? `${JSON.stringify(value)}\n`
      : flags.jsonl
        ? operation
          ? ""
          : `${JSON.stringify({ schema: "benchpilot.event", version: 1, event: { type: "command.result", timestamp: new Date().toISOString() }, context: {}, data: { result: value } })}\n`
        : (plain ?? `${JSON.stringify(value, null, 2)}\n`),
  );
}
