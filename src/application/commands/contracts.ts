import type { Json, Safety } from "../../core.js";

export type InteractionRequirement = "never" | "when-incomplete" | "required";

export interface CommandField {
  name: string;
  summary?: string;
  required?: boolean;
  schema?: Json;
  secret?: boolean;
  aliases?: string[];
  positional?: number;
  repeatable?: boolean;
}

/** Transport-neutral command description used by argv, help, and interaction. */
export interface CommandNode {
  id: string;
  path: readonly string[];
  summaryKey: string;
  fields: readonly CommandField[];
  interaction: InteractionRequirement;
  safety?: Safety;
  lockMode?: "none" | "exclusive";
  defaultTimeoutMs?: number;
  createsRun?: boolean;
  inputSchema?: Json;
  outputSchema?: Json;
  availability?: "available" | "unavailable";
  unavailableReason?: string;
  unavailableReasonCode?: string;
  options?: readonly CommandField[];
  handler?: string;
}

export interface CommandIntent {
  commandId: string;
  input: Json;
  options: Json;
}

export interface CommandOutcome {
  kind: string;
  data: Json;
  notices?: Json[];
}
