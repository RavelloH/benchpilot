export type AdapterRuntimeErrorCode =
  | "ADAPTER_NOT_FOUND"
  | "ADAPTER_INDEX_INVALID"
  | "ADAPTER_BUNDLE_INVALID"
  | "ADAPTER_BUNDLE_HASH_MISMATCH"
  | "ADAPTER_PLATFORM_UNSUPPORTED"
  | "ADAPTER_CAPABILITY_DISABLED"
  | "ADAPTER_CAPABILITY_UNSUPPORTED"
  | "ADAPTER_CONFIG_INVALID"
  | "DEVICE_CONFIG_INVALID"
  | "CAPABILITY_INPUT_INVALID"
  | "CAPABILITY_OUTPUT_INVALID"
  | "ADAPTER_TEMPLATE_VALUE_MISSING"
  | "ADAPTER_TOOL_NOT_FOUND"
  | "ADAPTER_TOOL_CONFIG_INVALID"
  | "ADAPTER_TOOL_PROBE_FAILED"
  | "ADAPTER_ENVIRONMENT_UNAVAILABLE"
  | "ADAPTER_ACTION_FAILED"
  | "ADAPTER_PARSER_FAILED"
  | "ADAPTER_ARTIFACT_MISSING"
  | "ADAPTER_ARTIFACT_UNSAFE"
  | "ADAPTER_EXECUTOR_UNAVAILABLE";

export class AdapterRuntimeError extends Error {
  constructor(
    readonly code: AdapterRuntimeErrorCode,
    message: string,
    readonly retryable = false,
    readonly recovery: string[] = [],
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AdapterRuntimeError";
  }

  toJSON() {
    return {
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      recovery: this.recovery,
      details: this.details,
    };
  }
}
