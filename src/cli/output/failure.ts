import {
  CliEventEncoder,
  type CommandReference,
  type CommandResultKind,
  type CommandResultV3,
  type JsonObject,
} from "../../contracts/index.js";
import { BenchPilotError, coreErrorDefinition, type Json } from "../../core.js";
import type { Flags } from "../parser.js";
import { processOutputSink, type OutputSink } from "./sink.js";

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
  readonly result: CommandResultV3 | Json;
  readonly command: CommandReference;
  readonly flags: Flags;
  readonly legacyOperation: boolean;
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
    if (input.legacyOperation)
      sink.stdout.write(
        `${JSON.stringify({ schema: "benchpilot.event", version: 2, event: { type: "operation.failed", timestamp: new Date().toISOString() }, context: {}, data: { error: input.result } })}\n`,
      );
    else {
      const encoder = new CliEventEncoder({ command: input.command });
      sink.stdout.write(
        `${[
          encoder.encode({ type: "command.started" }),
          encoder.encode({
            type: "command.failed",
            result: input.result as CommandResultV3,
          }),
        ]
          .map((event) => JSON.stringify(event))
          .join("\n")}\n`,
      );
    }
    return;
  }
  sink.stderr.write(`${input.humanMessage}\n`);
  if (input.help) sink.stderr.write(`\n${input.help}\n`);
};
