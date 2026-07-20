import {
  CAPABILITY_OUTCOME_SCHEMA,
  CAPABILITY_OUTCOME_VERSION,
  type CapabilityOutcome,
  type CommandReference,
  type CommandResultV3,
  type JsonObject,
  type JsonValue,
  messageRef,
} from "../../contracts/index.js";
import { coreErrorDefinition, type OperationOutcome } from "../../core.js";
import type { SystemOperationResult } from "../../application/systems/use-case.js";

const asJsonObject = (value: unknown): JsonObject | undefined =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : undefined;

const adapterMessageRef = (details: unknown) => {
  const message = asJsonObject(asJsonObject(details)?.messageRef);
  return typeof message?.key === "string" &&
    typeof message.fallback === "string"
    ? messageRef(message.key, undefined, message.fallback)
    : undefined;
};

/** Maps Core lifecycle facts to the sole public Capability data object. */
export const capabilityOutcomeFromOperation = (
  outcome: OperationOutcome,
): CapabilityOutcome => {
  const diagnostic = outcome.primaryError
    ? (() => {
        const definition = coreErrorDefinition(outcome.primaryError.kind);
        const adapterMessage = adapterMessageRef(outcome.primaryError.details);
        const details = {
          ...(asJsonObject(outcome.primaryError.details) ?? {}),
          ...(outcome.primaryError.recovery.length && !adapterMessage
            ? { recovery: outcome.primaryError.recovery }
            : {}),
        };
        return {
          level: "error" as const,
          adapter: outcome.subject.adapter,
          message:
            definition?.reason ??
            adapterMessage ??
            messageRef(
              "adapter.runtime.error",
              undefined,
              outcome.primaryError.message,
            ),
          ...(Object.keys(details).length ? { details } : {}),
        };
      })()
    : undefined;
  return {
    schema: CAPABILITY_OUTCOME_SCHEMA,
    version: CAPABILITY_OUTCOME_VERSION,
    subject: {
      scope: "device",
      adapter: outcome.subject.adapter,
      capability: outcome.subject.capability,
      device: outcome.subject.device,
    },
    execution: outcome.execution,
    ...(asJsonObject(outcome.output)
      ? { output: asJsonObject(outcome.output) }
      : {}),
    artifacts: outcome.artifacts.map((artifact) => ({
      name: artifact.name,
      kind: artifact.kind,
      path: artifact.path,
      size: artifact.size,
      sha256: artifact.sha256,
      createdAt: artifact.createdAt,
      ...(asJsonObject(artifact.metadata)
        ? { metadata: asJsonObject(artifact.metadata) }
        : {}),
    })),
    diagnostics: diagnostic ? [diagnostic] : [],
  };
};

/** Builds the public terminal Result without letting Core know its protocol. */
export const capabilityResultFromOperation = (input: {
  readonly command: CommandReference;
  readonly outcome: OperationOutcome;
}): CommandResultV3 => {
  const data = capabilityOutcomeFromOperation(input.outcome);
  const error = input.outcome.primaryError;
  const definition = error ? coreErrorDefinition(error.kind) : undefined;
  return {
    schema: "benchpilot.result",
    version: 3,
    ok: !error,
    command: input.command,
    kind: "operation",
    data: data as unknown as JsonValue,
    ...(error
      ? {
          error: {
            kind: error.kind,
            diagnosticId: error.diagnosticId,
            ...(definition?.reason
              ? { messageRef: definition.reason }
              : { message: error.message }),
            retryable: error.retryable,
            ...(error.stage ? { stage: error.stage } : {}),
            ...(definition?.recovery ? { recovery: definition.recovery } : {}),
            ...(asJsonObject(error.details)
              ? { details: asJsonObject(error.details) }
              : {}),
          },
        }
      : {}),
    meta: {
      startedAt: input.outcome.execution.startedAt,
      endedAt: input.outcome.execution.endedAt,
      durationMs: input.outcome.execution.durationMs,
      ...(input.outcome.execution.runId
        ? { runId: input.outcome.execution.runId }
        : {}),
      dryRun: input.outcome.execution.dryRun,
    },
  };
};

/** Projects a system fan-out from the same member outcomes as a device result. */
export const capabilityResultFromSystem = (input: {
  readonly command: CommandReference;
  readonly result: SystemOperationResult;
}): CommandResultV3 => {
  const outcomes = input.result.results.flatMap((member) =>
    member.outcome ? [member.outcome] : [],
  );
  if (!outcomes.length)
    throw new Error("System operation completed without lifecycle outcomes.");
  const first = outcomes[0]!;
  const startedAt = outcomes.reduce(
    (earliest, outcome) =>
      outcome.execution.startedAt < earliest
        ? outcome.execution.startedAt
        : earliest,
    first.execution.startedAt,
  );
  const endedAt = outcomes.reduce(
    (latest, outcome) =>
      outcome.execution.endedAt > latest ? outcome.execution.endedAt : latest,
    first.execution.endedAt,
  );
  const primaryError = outcomes.find(
    (outcome) => outcome.primaryError,
  )?.primaryError;
  const definition = primaryError
    ? coreErrorDefinition(primaryError.kind)
    : undefined;
  const status = primaryError
    ? outcomes.some((outcome) => outcome.status === "failed")
      ? "failed"
      : "aborted"
    : "succeeded";
  const data: CapabilityOutcome = {
    schema: CAPABILITY_OUTCOME_SCHEMA,
    version: CAPABILITY_OUTCOME_VERSION,
    subject: {
      scope: "system",
      adapters: [
        ...new Set(outcomes.map((outcome) => outcome.subject.adapter)),
      ].sort(),
      capability: input.result.capability,
      system: { instance: input.result.system },
    },
    execution: {
      status,
      startedAt,
      endedAt,
      durationMs: Math.max(0, Date.parse(endedAt) - Date.parse(startedAt)),
      dryRun: outcomes.every((outcome) => outcome.execution.dryRun),
    },
    output: { policy: input.result.policy },
    artifacts: [],
    diagnostics: [],
    members: input.result.results.flatMap((member) => {
      if (!member.outcome) return [];
      const {
        subject: _subject,
        members: _members,
        ...outcome
      } = capabilityOutcomeFromOperation(member.outcome);
      return [
        {
          device: member.outcome.subject.device,
          outcome,
        },
      ];
    }),
  };
  return {
    schema: "benchpilot.result",
    version: 3,
    ok: !primaryError,
    command: input.command,
    kind: "operation",
    data: data as unknown as JsonValue,
    ...(primaryError
      ? {
          error: {
            kind: primaryError.kind,
            diagnosticId: primaryError.diagnosticId,
            ...(definition?.reason
              ? { messageRef: definition.reason }
              : { message: primaryError.message }),
            retryable: primaryError.retryable,
            ...(primaryError.stage ? { stage: primaryError.stage } : {}),
            ...(definition?.recovery ? { recovery: definition.recovery } : {}),
            ...(asJsonObject(primaryError.details)
              ? { details: asJsonObject(primaryError.details) }
              : {}),
          },
        }
      : {}),
    meta: {
      startedAt,
      endedAt,
      durationMs: Math.max(0, Date.parse(endedAt) - Date.parse(startedAt)),
      dryRun: data.execution.dryRun,
    },
  };
};
