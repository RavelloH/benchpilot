import { stdout } from "node:process";
import type { Json } from "../core.js";
import { t, type Locale } from "../i18n/index.js";
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

const errorMessageKey = (kind: string) => {
  if (/^(USAGE|INVALID_)/.test(kind)) return "error.usage";
  if (/^(CONFIG|PROJECT|UNKNOWN_ADAPTER|ADAPTER_)/.test(kind))
    return "error.configuration";
  if (/^(DEVICE|UNSUPPORTED_CAPABILITY)/.test(kind)) return "error.device";
  if (/^SYSTEM/.test(kind)) return "error.system";
  if (/^(LOCK|DEVICE_BUSY)/.test(kind)) return "error.lock";
  if (/^(APPROVAL|HUMAN_APPROVAL|DANGEROUS_CONFIRMATION)/.test(kind))
    return "error.approval";
  if (/^(OPERATION|CLEANUP|INVALID_ARTIFACT)/.test(kind))
    return "error.operation";
  if (/^(INTERACTION|AGENT_INTERACTION|INTERACTIVE_)/.test(kind))
    return "error.interaction";
  if (kind === "INTERNAL_ERROR") return "error.internal";
  return "error.unknown";
};

/** Human-only localization; machine DTO messages are deliberately untouched. */
export const humanErrorMessage = (
  locale: Locale,
  kind: string,
  fallback: string,
) => t(locale, errorMessageKey(kind), { message: fallback });
