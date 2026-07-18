import type { AgentDetection } from "../agent/detector.js";

export type InteractionDecision =
  | { allowed: true }
  | { allowed: false; reason: "agent"; agent: AgentDetection }
  | { allowed: false; reason: "machine-output" }
  | { allowed: false; reason: "terminal-unavailable" };

export function interactionDecision(input: {
  agent?: AgentDetection;
  nonInteractive?: boolean;
  json?: boolean;
  jsonl?: boolean;
  stdinIsTTY?: boolean;
  stdoutIsTTY?: boolean;
}): InteractionDecision {
  if (input.nonInteractive)
    return {
      allowed: false,
      reason: "agent",
      agent: {
        kind: "agent",
        name: "Non-interactive mode",
        marker: "--non-interactive",
      },
    };
  if (input.agent)
    return { allowed: false, reason: "agent", agent: input.agent };
  if (input.json || input.jsonl)
    return { allowed: false, reason: "machine-output" };
  if (!input.stdinIsTTY || !input.stdoutIsTTY)
    return { allowed: false, reason: "terminal-unavailable" };
  return { allowed: true };
}
