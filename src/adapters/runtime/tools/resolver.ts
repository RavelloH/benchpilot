import { access, glob, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { constants } from "node:fs";
import { AdapterRuntimeError } from "../errors.js";
import {
  lookup,
  object,
  renderTemplate,
  type RuleObject,
} from "../rules/template.js";

export interface ResolvedTool {
  id: string;
  path: string;
  discoveryId: string;
  environmentId: string;
  prefixArgs: string[];
}

const platformEnabled = (candidate: RuleObject, platform: string) =>
  object(candidate.platforms)[platform] !== false;
const candidateOrder = (candidates: unknown[]) =>
  candidates
    .map((candidate, index) => ({ candidate: object(candidate), index }))
    .sort(
      (left, right) =>
        Number(right.candidate.priority ?? 0) -
          Number(left.candidate.priority ?? 0) || left.index - right.index,
    );
const envValue = (env: NodeJS.ProcessEnv, name: string) => {
  const entry = Object.entries(env).find(
    ([key]) =>
      key === name ||
      (process.platform === "win32" &&
        key.toLowerCase() === name.toLowerCase()),
  );
  return entry?.[1];
};

const validatePath = async (candidate: string, validation: RuleObject) => {
  const resolved = await realpath(candidate).catch(() => undefined);
  if (!resolved) return undefined;
  const metadata = await stat(resolved).catch(() => undefined);
  if (!metadata) return undefined;
  if (validation.path_type === "file" && !metadata.isFile()) return undefined;
  if (validation.path_type === "directory" && !metadata.isDirectory())
    return undefined;
  if (validation.executable === true && process.platform !== "win32")
    try {
      await access(resolved, constants.X_OK);
    } catch {
      return undefined;
    }
  return resolved;
};

const pathNames = (names: unknown[], env: NodeJS.ProcessEnv) => {
  const extensions =
    process.platform === "win32"
      ? (envValue(env, "PATHEXT") || ".COM;.EXE;.BAT;.CMD")
          .split(";")
          .filter(Boolean)
      : [""];
  return names.flatMap((name) =>
    extensions.some((extension) =>
      String(name).toLowerCase().endsWith(extension.toLowerCase()),
    )
      ? [String(name)]
      : extensions.map((extension) => `${String(name)}${extension}`),
  );
};

export class ToolResolver {
  constructor(
    private readonly platform: "windows" | "linux" | "macos",
    private readonly env: NodeJS.ProcessEnv,
  ) {}

  async resolve(
    toolId: string,
    tools: RuleObject,
    discoveries: RuleObject,
    context: RuleObject,
  ): Promise<ResolvedTool> {
    return this.resolveTool(toolId, tools, discoveries, context, new Set());
  }

  private async resolveTool(
    toolId: string,
    tools: RuleObject,
    discoveries: RuleObject,
    context: RuleObject,
    resolving: Set<string>,
  ): Promise<ResolvedTool> {
    if (resolving.has(toolId))
      throw new AdapterRuntimeError(
        "ADAPTER_TOOL_NOT_FOUND",
        `Tool dependency cycle includes ${toolId}.`,
      );
    resolving.add(toolId);
    const tool = object(tools[toolId]);
    const launch = object(tool.launch);
    const discoveryId = String(tool.discovery);
    const discovery = object(discoveries[discoveryId]);
    if (!Object.keys(tool).length || !Object.keys(discovery).length)
      throw new AdapterRuntimeError(
        "ADAPTER_TOOL_NOT_FOUND",
        `Tool not found: ${toolId}`,
      );
    const pathValue = await this.resolveDiscovery(
      discoveryId,
      discovery,
      context,
    );
    const renderContext = {
      ...context,
      discovery: { ...object(context.discovery), path: pathValue },
    };
    const ownPrefix = Array.isArray(launch.prefix_args)
      ? launch.prefix_args.map((value) =>
          String(renderTemplate(value, renderContext) ?? ""),
        )
      : [];
    const parent =
      launch.mode === "via-tool"
        ? await this.resolveTool(
            String(launch.tool),
            tools,
            discoveries,
            context,
            resolving,
          )
        : undefined;
    resolving.delete(toolId);
    return {
      id: toolId,
      path: parent?.path ?? pathValue,
      discoveryId,
      environmentId: String(launch.environment),
      prefixArgs: [...(parent?.prefixArgs ?? []), ...ownPrefix],
    };
  }

  private async resolveDiscovery(
    discoveryId: string,
    discovery: RuleObject,
    context: RuleObject,
  ): Promise<string> {
    const validation = object(discovery.validation);
    for (const { candidate } of candidateOrder(
      Array.isArray(discovery.candidates) ? discovery.candidates : [],
    )) {
      if (!platformEnabled(candidate, this.platform)) continue;
      const explicit = ["config", "config-path"].includes(
        String(candidate.type),
      );
      const paths = await this.candidatePaths(candidate, context);
      if (!paths.length) continue;
      for (const candidatePath of paths) {
        const resolved = await validatePath(candidatePath, validation);
        if (resolved) return resolved;
      }
      if (explicit)
        throw new AdapterRuntimeError(
          "ADAPTER_TOOL_CONFIG_INVALID",
          `Configured path is invalid for discovery ${discoveryId}.`,
          false,
          ["Correct the configured tool path before retrying."],
          { discoveryId, candidateId: candidate.id },
        );
    }
    throw new AdapterRuntimeError(
      "ADAPTER_TOOL_NOT_FOUND",
      `No valid candidate found for discovery ${discoveryId}.`,
      false,
      ["Install the tool or configure its path."],
      { discoveryId },
    );
  }

  private async candidatePaths(candidate: RuleObject, context: RuleObject) {
    const type = String(candidate.type);
    if (type === "config" || type === "config-path") {
      const value = lookup(object(context.config), String(candidate.key));
      if (typeof value !== "string" || !value) return [];
      const append = Array.isArray(candidate.append)
        ? candidate.append.map((item) => String(item))
        : [];
      return [path.resolve(value, ...append)];
    }
    if (type === "environment" || type === "environment-path") {
      const value = envValue(this.env, String(candidate.variable));
      if (!value) return [];
      const append = Array.isArray(candidate.append)
        ? candidate.append.map((item) => String(item))
        : [];
      return [path.resolve(value, ...append)];
    }
    if (type === "path") {
      const directories = (envValue(this.env, "PATH") || "").split(
        path.delimiter,
      );
      const names = pathNames(
        Array.isArray(candidate.names) ? candidate.names : [],
        this.env,
      );
      return directories.flatMap((directory) =>
        names.map((name) => path.resolve(directory || ".", name)),
      );
    }
    if (type === "fixed")
      return (Array.isArray(candidate.paths) ? candidate.paths : []).map(
        (item) => path.resolve(String(renderTemplate(item, context) ?? "")),
      );
    if (type === "glob") {
      const matches: string[] = [];
      for (const pattern of Array.isArray(candidate.patterns)
        ? candidate.patterns
        : [])
        for await (const match of glob(
          String(renderTemplate(pattern, context) ?? ""),
        ))
          matches.push(path.resolve(match));
      return matches.sort((left, right) => left.localeCompare(right));
    }
    return [];
  }
}
