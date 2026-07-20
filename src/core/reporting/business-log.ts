import type { Json } from "../config/config.js";

export interface BusinessLogEventOptions {
  readonly level?: "error" | "warn" | "info" | "debug";
}

/** Capability-facing business logger. */
export interface OperationLogger {
  debug(message: string): void;
  info(message: string): void;
  warn(message: string): void;
}

/** Audit log opened for one operation and closed before Run finalization. */
export interface BusinessLog extends OperationLogger {
  event(type: string, data?: Json, options?: BusinessLogEventOptions): void;
  close(): Promise<void>;
}

export interface BusinessLogOpenOptions {
  readonly logFilePath?: string;
  readonly jsonlFilePath?: string;
  readonly context: Json;
}

export interface BusinessLogFactory {
  open(options: BusinessLogOpenOptions): BusinessLog;
}
