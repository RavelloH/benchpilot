import type { RuntimeSchema } from "../adapters/schemas.js";
import type { Json } from "../config/config.js";
import type { OperationContext } from "../operations/types.js";

export interface Safety {
  mode: "normal" | "caution" | "destructive" | "irreversible";
  effects?: string[];
  approvalTtlMs?: number;
}

export interface OptionDefinition {
  name: string;
  summary: string;
  required?: boolean;
  schema?: RuntimeSchema<unknown>;
  aliases?: string[];
  positional?: number;
  secret?: boolean;
  repeatable?: boolean;
  hidden?: boolean;
}

export interface Capability {
  id: string;
  summary: string;
  description?: string;
  options?: OptionDefinition[];
  inputSchema?: RuntimeSchema<Json>;
  outputSchema?: RuntimeSchema<Json>;
  redactInput?(input: Json): Json;
  /** Removes schema-marked secrets before lifecycle facts leave the Core. */
  redactOutput?(output: Json): Json;
  defaultTimeoutMs: number;
  lockMode: "none" | "exclusive";
  createsRun: boolean;
  ttyOnly?: boolean;
  safety: Safety;
  execute(context: OperationContext, input: Json): Promise<Json>;
}

/** Read-only, JSON-safe metadata for menus, help, and operation planning. */
export interface CapabilityDescriptor {
  id: string;
  summary: string;
  description?: string;
  options: Array<{
    name: string;
    summary: string;
    required?: boolean;
    schema?: Json;
    aliases?: string[];
    positional?: number;
    secret?: boolean;
    repeatable?: boolean;
  }>;
  inputSchema?: Json;
  outputSchema?: Json;
  defaultTimeoutMs: number;
  lockMode: "none" | "exclusive";
  createsRun: boolean;
  ttyOnly?: boolean;
  safety: Safety;
  availability: "available";
}

export type ManagedSessionCapabilityKind =
  "start" | "logs" | "stop" | "console" | "send" | "request";

export interface ManagedSessionProtocolMethod {
  id: string;
  requestSchema: RuntimeSchema<Json>;
  responseSchema: RuntimeSchema<Json>;
  timeoutMs: number;
  safety: Safety["mode"];
}

export interface ManagedSessionProtocol {
  id: string;
  framing: "json-lines" | "length-prefixed" | "cbor";
  maxRequestBytes: number;
  telemetrySchema?: RuntimeSchema<Json>;
  methods: readonly ManagedSessionProtocolMethod[];
}

/** Fully rendered adapter declaration consumed by the future session host. */
export interface ManagedSessionPlan {
  capabilityId: string;
  kind: ManagedSessionCapabilityKind;
  sessionId: string;
  port: string;
  baud: number;
  encoding: "utf8" | "binary";
  lineFraming: "line" | "raw";
  openLinePolicy: {
    dtr: "preserve" | "off" | "on";
    rts: "preserve" | "off" | "on";
  };
  logRecordLimit: number;
  spoolLimitBytes: number;
  rawCaptureLimitBytes: number;
  writeLimitBytes: number;
  protocols: readonly ManagedSessionProtocol[];
}

export interface DeviceRuntime {
  identity: {
    instance: string;
    physicalId: string;
    adapter: string;
    /** False means the physical identity is not safe to lock. */
    stable?: boolean;
  };
  capabilities(): Capability[];
  resolveManagedSession?(
    capabilityId: string,
    context: { projectRoot: string },
  ): ManagedSessionPlan | undefined;
}
