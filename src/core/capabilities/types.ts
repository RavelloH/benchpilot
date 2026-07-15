import type { RuntimeSchema } from "../adapters/schemas.js";
import type { Json } from "../config/config.js";
import type { OperationContext } from "../operations/types.js";

export interface Safety {
  mode: "normal" | "danger-flag" | "human-approval";
  flag?: string;
  effects?: string[];
  approvalTtlMs?: number;
}

export interface OptionDefinition {
  name: string;
  summary: string;
  required?: boolean;
  schema?: RuntimeSchema<unknown>;
}

export interface Capability {
  id: string;
  summary: string;
  description?: string;
  options?: OptionDefinition[];
  inputSchema?: RuntimeSchema<Json>;
  outputSchema?: RuntimeSchema<Json>;
  defaultTimeoutMs: number;
  lockMode: "none" | "exclusive";
  createsRun: boolean;
  safety: Safety;
  execute(context: OperationContext, input: Json): Promise<Json>;
}

export interface DeviceRuntime {
  identity: { instance: string; physicalId: string; adapter: string };
  capabilities(): Capability[];
}
