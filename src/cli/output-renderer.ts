import { stdout } from "node:process";
import type { Json } from "../core.js";
import { t, type Locale, type MessageKey } from "../i18n/index.js";
import { renderDataPage } from "./data-renderer.js";
import type { CliDataPage } from "./data/page.js";
import type { Flags } from "./parser.js";
import {
  jsonlPresentation,
  jsonPresentation,
  screenPresentation,
  type CliNode,
  type PresentationJsonlComplete,
  type PresentationJsonlSnapshot,
  type PresentationJsonlStart,
  type PresentationView,
} from "./presentation/page.js";

export interface OutputSink {
  stdout: { write(value: string): unknown };
  stderr: { write(value: string): unknown };
}

export const processOutputSink: OutputSink = {
  stdout,
  stderr: process.stderr,
};

const machineResult = (value: unknown): Json => {
  if (
    value &&
    typeof value === "object" &&
    ((value as Json).schema === "benchpilot.result" ||
      (value as Json).schema === "benchpilot.help" ||
      (value as Json).schema === "benchpilot.help-index")
  )
    return value as Json;
  return {
    schema: "benchpilot.result",
    version: 2,
    ok: true,
    kind: "COMMAND_COMPLETED",
    data: value as Json,
  };
};

export function write(
  value: unknown,
  flags: Flags,
  plain?: string,
  sink: OutputSink = processOutputSink,
) {
  const machine = machineResult(value);
  const operation =
    machine &&
    typeof machine === "object" &&
    machine.schema === "benchpilot.result" &&
    machine.kind !== "COMMAND_COMPLETED" &&
    machine.dryRun !== true;
  sink.stdout.write(
    flags.json
      ? `${JSON.stringify(machine)}\n`
      : flags.jsonl
        ? operation
          ? ""
          : `${JSON.stringify({ schema: "benchpilot.event", version: 2, event: { type: "command.result", timestamp: new Date().toISOString() }, context: {}, data: { result: machine } })}\n`
        : (plain ?? `${JSON.stringify(value, null, 2)}\n`),
  );
}

export function writeText(value: string, sink: OutputSink = processOutputSink) {
  sink.stdout.write(value);
}

/** The only stdout writer for canonical command data. */
export function writeDataPage<T extends object>(input: {
  readonly page: CliDataPage<T>;
  readonly flags: Flags;
  readonly locale: Locale;
  readonly view: PresentationView;
  readonly color: boolean;
  readonly sink?: OutputSink;
}) {
  (input.sink ?? processOutputSink).stdout.write(renderDataPage(input));
}

/** The only stdout writer for presentation pages. */
export function writePresentation(input: {
  readonly nodes: readonly CliNode[];
  readonly flags: Flags;
  readonly locale: Locale;
  readonly view: PresentationView;
  readonly sink?: OutputSink;
}) {
  const sink = input.sink ?? processOutputSink;
  if (input.flags.json) {
    sink.stdout.write(`${JSON.stringify(jsonPresentation(input.nodes))}\n`);
    return;
  }
  if (input.flags.jsonl) {
    const snapshots = jsonlPresentation(input.nodes);
    const records: readonly (
      | PresentationJsonlStart
      | PresentationJsonlSnapshot
      | PresentationJsonlComplete
    )[] = [
      {
        op: "start",
        protocol: "benchpilot.presentation",
        version: 1,
        locale: input.locale,
        view: input.view,
      },
      ...snapshots,
      { op: "complete", count: snapshots.length },
    ];
    sink.stdout.write(
      `${records.map((record) => JSON.stringify(record)).join("\n")}\n`,
    );
    return;
  }
  sink.stdout.write(screenPresentation(input.nodes));
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

const errorMessageKey = (kind: string): MessageKey => {
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
