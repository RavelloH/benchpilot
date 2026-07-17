import type { Json, Safety } from "../../core.js";

export type InteractionRequirement = "never" | "when-incomplete" | "required";

export interface CommandField {
  name: string;
  required?: boolean;
  schema?: Json;
  secret?: boolean;
}

/** Transport-neutral command description used by argv, help, and interaction. */
export interface CommandNode {
  id: string;
  path: readonly string[];
  summaryKey: string;
  fields: readonly CommandField[];
  interaction: InteractionRequirement;
  safety?: Safety;
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
