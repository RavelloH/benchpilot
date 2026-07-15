import type { BenchPilotError } from "../errors/benchpilot-error.js";
import type { Json } from "../../core.js";

export interface CleanupError {
  name: string;
  critical: boolean;
  message: string;
}

export interface OperationOutcome {
  status: "succeeded" | "failed" | "aborted";
  result: Json;
  primaryError?: BenchPilotError;
  cleanupErrors: CleanupError[];
}
