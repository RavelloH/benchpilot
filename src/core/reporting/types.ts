import type { Json } from "../config/config.js";

export type OperationReportAudience =
  "public" | "public-diagnostic" | "audit" | "debug";

export interface OperationReportOptions {
  readonly level?: "error" | "warn" | "info" | "debug";
  readonly audience?: OperationReportAudience;
}

/** Transport-neutral operation event sink. Core never serializes public output. */
export interface OperationReporter {
  emit(type: string, data?: Json, options?: OperationReportOptions): void;
  child?(context: Json): OperationReporter;
}
