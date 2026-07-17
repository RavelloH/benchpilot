import type { AgentDetection } from "../agent/detector.js";

export type InteractionDecision =
  | { allowed: true }
  | { allowed: false; reason: "agent"; agent: AgentDetection }
  | { allowed: false; reason: "machine-output" }
  | { allowed: false; reason: "terminal-unavailable" };

export function interactionDecision(input: {
  agent?: AgentDetection;
  json?: boolean;
  jsonl?: boolean;
  stdinIsTTY?: boolean;
  stdoutIsTTY?: boolean;
  ci?: boolean;
}): InteractionDecision {
  if (input.agent)
    return { allowed: false, reason: "agent", agent: input.agent };
  if (input.json || input.jsonl)
    return { allowed: false, reason: "machine-output" };
  if (!input.stdinIsTTY || !input.stdoutIsTTY || input.ci)
    return { allowed: false, reason: "terminal-unavailable" };
  return { allowed: true };
}
