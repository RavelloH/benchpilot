import { BenchPilotError } from "../errors/benchpilot-error.js";

export type OperationAbortReason =
  | { kind: "timeout"; timeoutMs: number }
  | { kind: "signal"; signal: "SIGINT" | "SIGTERM" }
  | {
      kind: "lock-ownership-lost";
      lockId: string;
      error: BenchPilotError;
    }
  | { kind: "manual"; message?: string };

export function abortReasonToError(reason: unknown): BenchPilotError {
  if (reason && typeof reason === "object") {
    const value = reason as Partial<OperationAbortReason>;
    if (value.kind === "lock-ownership-lost") {
      const lockLoss = reason as Extract<
        OperationAbortReason,
        { kind: "lock-ownership-lost" }
      >;
      return lockLoss.error;
    }
    if (value.kind === "timeout") {
      const timeoutMs = Number(
        (reason as Extract<OperationAbortReason, { kind: "timeout" }>)
          .timeoutMs,
      );
      return new BenchPilotError(
        "OPERATION_TIMEOUT",
        6,
        `Operation timed out after ${timeoutMs}ms.`,
        false,
        undefined,
        [],
        { abortReason: reason },
      );
    }
    if (value.kind === "signal") {
      const signal = (
        reason as Extract<OperationAbortReason, { kind: "signal" }>
      ).signal;
      return new BenchPilotError(
        "OPERATION_ABORTED",
        6,
        `Operation aborted by ${signal}.`,
        false,
        undefined,
        [],
        { abortReason: reason, signal },
      );
    }
    if (value.kind === "manual") {
      return new BenchPilotError(
        "OPERATION_ABORTED",
        6,
        (reason as Extract<OperationAbortReason, { kind: "manual" }>).message ||
          "Operation aborted.",
        false,
        undefined,
        [],
        { abortReason: reason },
      );
    }
  }
  if (reason instanceof BenchPilotError) return reason;
  if (reason instanceof Error)
    return new BenchPilotError("OPERATION_ABORTED", 6, reason.message);
  return new BenchPilotError("OPERATION_ABORTED", 6, "Operation aborted.");
}

export function abortPromise(signal: AbortSignal): Promise<never> {
  if (signal.aborted) return Promise.reject(abortReasonToError(signal.reason));
  return new Promise((_, reject) => {
    const onAbort = () => {
      signal.removeEventListener("abort", onAbort);
      reject(abortReasonToError(signal.reason));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
