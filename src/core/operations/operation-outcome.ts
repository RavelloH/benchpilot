import type { BenchPilotError } from "../errors/benchpilot-error.js";
import type { Json } from "../../core.js";
import type { ArtifactRecord } from "../artifacts/types.js";

export interface CleanupError {
  name: string;
  critical: boolean;
  holdsPhysicalResource: boolean;
  timedOut: boolean;
  message: string;
}

export interface OperationOutcome {
  status: "succeeded" | "failed" | "aborted";
  command: string;
  subject: {
    adapter: string;
    capability: string;
    device: {
      instance: string;
      physicalId: string;
    };
  };
  execution: {
    status: "succeeded" | "failed" | "aborted";
    startedAt: string;
    endedAt: string;
    durationMs: number;
    runId?: string;
    dryRun: boolean;
  };
  output?: Json;
  artifacts: readonly ArtifactRecord[];
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
