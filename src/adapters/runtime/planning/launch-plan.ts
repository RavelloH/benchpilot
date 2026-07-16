import type { ResolvedTool } from "../tools/resolver.js";
import {
  planActionArguments,
  planActionEnvironment,
} from "./action-planner.js";
import {
  object,
  renderRequiredTemplate,
  type RuleObject,
} from "../rules/template.js";

export interface ProcessLaunchPlan {
  kind: "process";
  executable: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
  parserId?: string;
  artifactSetId?: string;
}

export interface CopyLaunchPlan {
  kind: "copy";
  from: string;
  to: string;
  recursive: boolean;
  overwrite: boolean;
  timeoutMs: number;
  parserId?: string;
  artifactSetId?: string;
}

export interface SerialLaunchPlan {
  kind: "serial";
  actionType: "serial-read" | "serial-write";
  timeoutMs: number;
  parserId?: string;
  artifactSetId?: string;
}

export type LaunchPlan = ProcessLaunchPlan | CopyLaunchPlan | SerialLaunchPlan;

export const durationMs = (value: unknown, fallback = 0) => {
  const match = /^([1-9]\d*)(ms|s|m|h)$/.exec(String(value ?? ""));
  if (!match) return fallback;
  const scale = { ms: 1, s: 1_000, m: 60_000, h: 3_600_000 }[match[2]];
  return Number(match[1]) * (scale ?? 1);
};

export const planLaunch = (
  action: RuleObject,
  context: RuleObject,
  tool: ResolvedTool | undefined,
  environment: NodeJS.ProcessEnv,
): LaunchPlan => {
  if (action.type === "process") {
    if (!tool)
      throw new Error(`Resolved tool is required: ${String(action.tool)}`);
    return {
      kind: "process",
      executable: tool.executable ?? tool.path,
      args: [
        ...tool.prefixArgs,
        ...planActionArguments(action, context).map((argument) =>
          String(argument),
        ),
      ],
      cwd: String(renderRequiredTemplate(action.cwd, context, "cwd") ?? ""),
      env: {
        ...environment,
        ...Object.fromEntries(
          Object.entries(planActionEnvironment(action, context)).map(
            ([key, value]) => [key, String(value)],
          ),
        ),
      },
      timeoutMs: durationMs(action.timeout),
      parserId: typeof action.parser === "string" ? action.parser : undefined,
      artifactSetId:
        typeof action.artifact_set === "string"
          ? action.artifact_set
          : undefined,
    };
  }
  if (action.type === "copy")
    return {
      kind: "copy",
      from: String(
        renderRequiredTemplate(action.from, context, "copy.from") ?? "",
      ),
      to: String(renderRequiredTemplate(action.to, context, "copy.to") ?? ""),
      recursive: action.recursive === true,
      overwrite: action.overwrite === true,
      timeoutMs: durationMs(action.timeout),
      parserId: typeof action.parser === "string" ? action.parser : undefined,
      artifactSetId:
        typeof action.artifact_set === "string"
          ? action.artifact_set
          : undefined,
    };
  const type = String(action.type);
  if (type === "serial-read" || type === "serial-write")
    return {
      kind: "serial",
      actionType: type,
      timeoutMs: durationMs(action.timeout),
      parserId: typeof action.parser === "string" ? action.parser : undefined,
      artifactSetId:
        typeof action.artifact_set === "string"
          ? action.artifact_set
          : undefined,
    };
  throw new Error(`Unsupported action type: ${type}`);
};
