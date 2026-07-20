import {
  CliEventEncoder,
  type CommandReference,
  type CommandResultKind,
  type CommandResultV3,
  type JsonObject,
} from "../../contracts/index.js";
import { BenchPilotError, coreErrorDefinition } from "../../core.js";
import type { Flags } from "../parser.js";
import { processOutputSink, type OutputSink } from "./sink.js";
import {
  isMessageKey,
  t,
  type Locale,
  type MessageKey,
} from "../../i18n/index.js";

const localizedErrorReason = (
  locale: Locale,
  kind: string,
  fallback: string,
) => {
  const key = coreErrorDefinition(kind)?.reason.key;
  if (isMessageKey(key)) return t(locale, key);
  return locale === "zh-CN"
    ? t(locale, "error.reason.untranslated", { kind })
    : fallback;
};

/** Human-only localization; machine DTO messages are deliberately untouched. */
export const humanErrorMessage = (
  locale: Locale,
  kind: string,
  fallback: string,
) => {
  const category = coreErrorDefinition(kind)?.category.key;
  const categoryKey: MessageKey = isMessageKey(category)
    ? category
    : "error.unknown";
  return t(locale, categoryKey, {
    message: localizedErrorReason(locale, kind, fallback),
  });
};

export const commandFailureResult = (input: {
  readonly command: CommandReference;
  readonly error: BenchPilotError;
  readonly kind?: CommandResultKind;
  readonly startedAt: Date;
  readonly endedAt?: Date;
}): CommandResultV3 => {
  const endedAt = input.endedAt ?? new Date();
  const definition = coreErrorDefinition(input.error.kind);
  return {
    schema: "benchpilot.result",
    version: 3,
    ok: false,
    command: input.command,
    kind: input.kind ?? "data",
    error: {
      kind: input.error.kind,
      diagnosticId: input.error.diagnosticId,
      ...(definition?.reason ? {} : { message: input.error.message }),
      ...(definition?.reason ? { messageRef: definition.reason } : {}),
      retryable: input.error.retryable,
      ...(input.error.stage ? { stage: input.error.stage } : {}),
      ...(definition?.recovery?.length
        ? { recovery: definition.recovery }
        : {}),
      details: input.error.details as JsonObject,
    },
    meta: {
      startedAt: input.startedAt.toISOString(),
      endedAt: endedAt.toISOString(),
      durationMs: Math.max(0, endedAt.getTime() - input.startedAt.getTime()),
    },
  };
};

/** Emits canonical command failures while preserving the deferred Operation bridge. */
export const renderFailure = (input: {
  readonly result: CommandResultV3;
  readonly command: CommandReference;
  readonly flags: Flags;
  readonly terminalEmitted: boolean;
  readonly humanMessage: string;
  readonly help?: string;
  readonly sink?: OutputSink;
}) => {
  const sink = input.sink ?? processOutputSink;
  if (input.flags.json) {
    sink.stdout.write(`${JSON.stringify(input.result)}\n`);
    return;
  }
  if (input.flags.jsonl && !input.terminalEmitted) {
    const encoder = new CliEventEncoder({ command: input.command });
    sink.stdout.write(
      `${[
        encoder.encode({ type: "command.started" }),
        encoder.encode({ type: "command.failed", result: input.result }),
      ]
        .map((event) => JSON.stringify(event))
        .join("\n")}\n`,
    );
    return;
  }
  sink.stderr.write(`${input.humanMessage}\n`);
  if (input.help) sink.stderr.write(`\n${input.help}\n`);
};
