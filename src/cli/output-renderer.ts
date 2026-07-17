import { stdout } from "node:process";
import type { Json } from "../core.js";
import type { Flags } from "./parser.js";

export interface OutputSink {
  stdout: { write(value: string): unknown };
  stderr: { write(value: string): unknown };
}

export const processOutputSink: OutputSink = {
  stdout,
  stderr: process.stderr,
};

export function write(
  value: unknown,
  flags: Flags,
  plain?: string,
  sink: OutputSink = processOutputSink,
) {
  const operation =
    value &&
    typeof value === "object" &&
    (value as Json).schema === "benchpilot.result";
  sink.stdout.write(
    flags.json
      ? `${JSON.stringify(value)}\n`
      : flags.jsonl
        ? operation
          ? ""
          : `${JSON.stringify({ schema: "benchpilot.event", version: 2, event: { type: "command.result", timestamp: new Date().toISOString() }, context: {}, data: { result: value } })}\n`
        : (plain ?? `${JSON.stringify(value, null, 2)}\n`),
  );
}

export function writeText(value: string, sink: OutputSink = processOutputSink) {
  sink.stdout.write(value);
}

export function writeFailure(input: {
  result: unknown;
  flags: Flags;
  isOperation: boolean;
  terminalEmitted: boolean;
  humanMessage: string;
  help?: string;
  sink?: OutputSink;
}) {
  const sink = input.sink ?? processOutputSink;
  if (input.flags.json) {
    sink.stdout.write(`${JSON.stringify(input.result)}\n`);
    return;
  }
  if (input.flags.jsonl && !input.terminalEmitted) {
    sink.stdout.write(
      `${JSON.stringify({ schema: "benchpilot.event", version: 2, event: { type: input.isOperation ? "operation.failed" : "command.failed", timestamp: new Date().toISOString() }, context: {}, data: { error: input.result } })}\n`,
    );
    return;
  }
  sink.stderr.write(`${input.humanMessage}\n`);
  if (input.help) sink.stderr.write(`\n${input.help}\n`);
}
