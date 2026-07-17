import { existsSync } from "node:fs";

export interface AgentDetectionContext {
  readonly env: Readonly<NodeJS.ProcessEnv>;
  readonly fileExists: (path: string) => boolean;
}

export interface AgentDetection {
  readonly kind: "agent";
  readonly name: string;
  readonly marker: string;
}

/** Version of the fixed environment/file agent-marker contract. */
export const AGENT_MARKER_CONTRACT_VERSION = 1;

const marker =
  (name: string, ...variables: string[]) =>
  ({ env, fileExists: _fileExists }: AgentDetectionContext) =>
    variables.some((variable) => Boolean(env[variable]))
      ? { kind: "agent" as const, name, marker: variables.find((x) => env[x])! }
      : undefined;

const value =
  (name: string, variable: string, expected: string) =>
  ({ env, fileExists: _fileExists }: AgentDetectionContext) =>
    env[variable] === expected
      ? { kind: "agent" as const, name, marker: variable }
      : undefined;

/** Fixed, versioned agent-marker contract. TTY, CI, and SSH are not identity signals. */
const matchers = [
  marker("Claude Code", "CLAUDECODE"),
  marker(
    "Codex",
    "CODEX_THREAD_ID",
    "CODEX_CI",
    "CODEX_SANDBOX",
    "CODEX_SANDBOX_NETWORK_DISABLED",
  ),
  marker("Gemini CLI", "GEMINI_CLI"),
  marker("Qwen Code", "QWEN_CODE"),
  marker("Cursor", "CURSOR_AGENT"),
  marker("GitHub Copilot CLI", "COPILOT_CLI"),
  marker("OpenCode", "OPENCODE", "OPENCODE_CLIENT"),
  marker("Cline", "CLINE_ACTIVE"),
  value("Goose", "AGENT", "goose"),
  value("Amp", "AGENT", "amp"),
  marker("Crush", "CRUSH"),
  value("Aider", "OR_APP_NAME", "Aider"),
  marker("Augment Code", "AUGMENT_AGENT"),
  marker("Antigravity", "ANTIGRAVITY_AGENT"),
  ({ env, fileExists: _fileExists }: AgentDetectionContext) =>
    env.REPLIT_SESSION?.startsWith("agent-")
      ? {
          kind: "agent" as const,
          name: "Replit Agent",
          marker: "REPLIT_SESSION",
        }
      : undefined,
  ({ env, fileExists }: AgentDetectionContext) =>
    fileExists("/opt/.devin")
      ? { kind: "agent" as const, name: "Devin", marker: "/opt/.devin" }
      : undefined,
  ({ env, fileExists: _fileExists }: AgentDetectionContext) => {
    const raw = env.AI_AGENT || env.AGENT;
    if (!raw) return undefined;
    return {
      kind: "agent" as const,
      name: "AI agent",
      marker: env.AI_AGENT ? "AI_AGENT" : "AGENT",
    };
  },
];

export function detectAgent(
  context: AgentDetectionContext = { env: process.env, fileExists: existsSync },
): AgentDetection | undefined {
  return matchers.map((matcher) => matcher(context)).find(Boolean);
}
