import { access, glob, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { constants } from "node:fs";
import { runProcess } from "../../../core/process/process-runner.js";
import { AdapterRuntimeError } from "../errors.js";
import { parseOutput } from "../rules/parser.js";
import {
  lookup,
  object,
  renderRequiredTemplate,
  type RuleObject,
} from "../rules/template.js";

export interface ResolvedTool {
  id: string;
  path: string;
  discoveryId: string;
  environmentId: string;
  prefixArgs: string[];
  probe?: RuleObject;
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

const probeTimeoutMs = (value: unknown) => {
  const match = /^([1-9]\d*)(ms|s|m|h)$/.exec(String(value));
  if (!match) return 5_000;
  const scale = { ms: 1, s: 1_000, m: 60_000, h: 3_600_000 }[match[2]];
  return Math.min(10_000, Number(match[1]) * (scale ?? 1));
};

export class ToolResolver {
  private probes = new Map<string, RuleObject>();
  constructor(
    private readonly platform: "windows" | "linux" | "macos",
    private readonly env: NodeJS.ProcessEnv,
  ) {}

  async resolve(
    toolId: string,
    tools: RuleObject,
    discoveries: RuleObject,
    context: RuleObject,
    parsers: RuleObject = {},
  ): Promise<ResolvedTool> {
    return this.resolveTool(
      toolId,
      tools,
      discoveries,
      context,
      parsers,
      new Set(),
    );
  }

  private async resolveTool(
    toolId: string,
    tools: RuleObject,
    discoveries: RuleObject,
    context: RuleObject,
    parsers: RuleObject,
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
    const resolved = await this.resolveDiscovery(
      discoveryId,
      discovery,
      context,
      parsers,
    );
    const pathValue = resolved.path;
    const renderContext = {
      ...context,
      discovery: { ...object(context.discovery), path: pathValue },
    };
    const ownPrefix = Array.isArray(launch.prefix_args)
      ? launch.prefix_args.map((value) =>
          String(
            renderRequiredTemplate(value, renderContext, "tool prefix") ?? "",
          ),
        )
      : [];
    const parent =
      launch.mode === "via-tool"
        ? await this.resolveTool(
            String(launch.tool),
            tools,
            discoveries,
            context,
            parsers,
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
      ...(Object.keys(resolved.probe).length ? { probe: resolved.probe } : {}),
    };
  }

  private async resolveDiscovery(
    discoveryId: string,
    discovery: RuleObject,
    context: RuleObject,
    parsers: RuleObject,
  ): Promise<{ path: string; probe: RuleObject }> {
    const validation = object(discovery.validation);
    let probeFailure: AdapterRuntimeError | undefined;
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
        if (!resolved) continue;
        try {
          return {
            path: resolved,
            probe: await this.runProbe(
              discoveryId,
              discovery,
              resolved,
              context,
              parsers,
            ),
          };
        } catch (error) {
          if (!(error instanceof AdapterRuntimeError)) throw error;
          probeFailure = error;
          if (explicit) throw error;
        }
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
    if (probeFailure) throw probeFailure;
    throw new AdapterRuntimeError(
      "ADAPTER_TOOL_NOT_FOUND",
      `No valid candidate found for discovery ${discoveryId}.`,
      false,
      ["Install the tool or configure its path."],
      { discoveryId },
    );
  }

  private async runProbe(
    discoveryId: string,
    discovery: RuleObject,
    executable: string,
    context: RuleObject,
    parsers: RuleObject,
  ): Promise<RuleObject> {
    const probe = object(discovery.probe);
    if (!Object.keys(probe).length) return {};
    const cacheKey = `${discoveryId}:${executable}`;
    const cached = this.probes.get(cacheKey);
    if (cached) return cached;
    const parserId = String(probe.parser);
    const parser = object(parsers[parserId]);
    if (!Object.keys(parser).length)
      throw new AdapterRuntimeError(
        "ADAPTER_TOOL_PROBE_FAILED",
        `Tool probe parser does not exist: ${parserId}`,
        false,
        [],
        { discoveryId, parserId },
      );
    const timeout = probeTimeoutMs(probe.timeout);
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(new Error("Tool probe timed out.")),
      timeout,
    );
    try {
      const execution = await runProcess({
        command: executable,
        args: (Array.isArray(probe.args) ? probe.args : []).map((value) =>
          String(renderRequiredTemplate(value, context, "tool probe") ?? ""),
        ),
        signal: controller.signal,
        captureOutput: true,
        maxCaptureBytes: 1_048_576,
      });
      const parsed = parseOutput(
        parser,
        execution.stdout ?? "",
        execution.stderr ?? "",
        execution.code,
      );
      if (!parsed.success)
        throw new AdapterRuntimeError(
          "ADAPTER_TOOL_PROBE_FAILED",
          `Tool probe failed for discovery ${discoveryId}.`,
          parsed.error?.retryable === true,
          Array.isArray(parsed.error?.recovery)
            ? parsed.error.recovery.map((item) => String(item))
            : [],
          { discoveryId, executable, exitCode: execution.code },
        );
      this.probes.set(cacheKey, parsed.result);
      return parsed.result;
    } catch (error) {
      if (error instanceof AdapterRuntimeError) throw error;
      throw new AdapterRuntimeError(
        "ADAPTER_TOOL_PROBE_FAILED",
        `Tool probe failed for discovery ${discoveryId}.`,
        false,
        [],
        { discoveryId, executable },
      );
    } finally {
      clearTimeout(timer);
    }
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
        (item) =>
          path.resolve(
            String(renderRequiredTemplate(item, context, "tool path") ?? ""),
          ),
      );
    if (type === "glob") {
      const matches: string[] = [];
      for (const pattern of Array.isArray(candidate.patterns)
        ? candidate.patterns
        : [])
        for await (const match of glob(
          String(renderRequiredTemplate(pattern, context, "tool glob") ?? ""),
        ))
          matches.push(path.resolve(match));
      return matches.sort((left, right) => left.localeCompare(right));
    }
    return [];
  }
}
