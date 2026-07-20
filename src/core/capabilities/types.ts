import type { RuntimeSchema } from "../adapters/schemas.js";
import type { Json } from "../config/config.js";
import type { OperationContext } from "../operations/types.js";

export interface Safety {
  mode: "normal" | "caution" | "destructive" | "irreversible";
  flag?: string;
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
  safety: Safety;
  availability: "available";
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
}
