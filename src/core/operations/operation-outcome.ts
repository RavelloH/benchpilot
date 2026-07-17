import type { BenchPilotError } from "../errors/benchpilot-error.js";
import type { Json } from "../../core.js";

export interface CleanupError {
  name: string;
  critical: boolean;
  holdsPhysicalResource: boolean;
  timedOut: boolean;
  message: string;
}

export interface OperationOutcome {
  status: "succeeded" | "failed" | "aborted";
  result: Json;
  primaryError?: BenchPilotError;
  cleanupErrors: CleanupError[];
  lockFinalStatus:
    | "not-required"
    | "released"
    | "quarantined"
    | "ownership-lost"
    | "quarantine-failed";
  quarantinedLock?: { lockId: string; reason: Json };
}
