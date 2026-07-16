import { access, glob, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { constants } from "node:fs";
import { runProcess } from "../../../core/process/process-runner.js";
import { sha, stable } from "../../../core/utilities/stable-json.js";
import { AdapterRuntimeError } from "../errors.js";
import { parseOutput } from "../rules/parser.js";
import {
  lookup,
  object,
  renderRequiredTemplate,
  type RuleObject,
} from "../rules/template.js";

/** The complete, shell-free launch description for a resolved declarative Tool. */
export interface ResolvedToolLaunch {
  toolId: string;
  executable: string;
  argsPrefix: string[];
  environmentId: string;
  discoveryId: string;
  discoveredPath: string;
  candidateId: string;
  discoveryResult: RuleObject;
  probeResult?: RuleObject;
  /** Launches in dependency order, from the executable owner to this Tool. */
  chain: ResolvedToolLaunch[];
}

/** @deprecated Use the explicit launch fields. Compatibility aliases are retained for v1 callers. */
export interface ResolvedTool extends ResolvedToolLaunch {
  id: string;
  path: string;
  prefixArgs: string[];
  probe?: RuleObject;
}

interface DiscoveryResolution {
  path: string;
  candidateId: string;
}

interface CandidatePaths {
  /** Whether an explicitly configured candidate was actually configured. */
  configured: boolean;
  paths: string[];
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
const envValue = (env: NodeJS.ProcessEnv, name: string, platform: string) => {
  const entry = Object.entries(env).find(
    ([key]) =>
      key === name ||
      (platform === "windows" && key.toLowerCase() === name.toLowerCase()),
  );
  return entry?.[1];
};

const validatePath = async (
  candidate: string,
  validation: RuleObject,
  platform: string,
) => {
  const resolved = await realpath(candidate).catch(() => undefined);
  if (!resolved) return undefined;
  const metadata = await stat(resolved).catch(() => undefined);
  if (!metadata) return undefined;
  if (validation.path_type === "file" && !metadata.isFile()) return undefined;
  if (validation.path_type === "directory" && !metadata.isDirectory())
    return undefined;
  if (validation.executable === true && platform !== "windows")
    try {
      await access(resolved, constants.X_OK);
    } catch {
      return undefined;
    }
  return resolved;
};

const pathNames = (
  names: unknown[],
  env: NodeJS.ProcessEnv,
  platform: string,
) => {
  const extensions =
    platform === "windows"
      ? (envValue(env, "PATHEXT", platform) || ".COM;.EXE;.BAT;.CMD")
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

const redactProbeOutput = (value: string, environment: NodeJS.ProcessEnv) => {
  const secrets = Object.values(environment)
    .filter(
      (item): item is string => typeof item === "string" && item.length >= 4,
    )
    .sort((left, right) => right.length - left.length);
  return secrets.reduce(
    (output, secret) => output.split(secret).join("[REDACTED]"),
    value,
  );
};

export class ToolResolver {
  private probes = new Map<string, RuleObject>();
  constructor(
    private readonly platform: "windows" | "linux" | "macos",
    private readonly env: NodeJS.ProcessEnv,
  ) {}

  /** Resolves a full Tool launch and, for backwards compatibility, performs its declared probe. */
  async resolve(
    toolId: string,
    tools: RuleObject,
    discoveries: RuleObject,
    context: RuleObject,
    parsers: RuleObject = {},
    options: {
      probe?: boolean;
      environment?: NodeJS.ProcessEnv;
      adapterId?: string;
      signal?: AbortSignal;
    } = {},
  ): Promise<ResolvedTool> {
    const launch = await this.resolveLaunch(
      toolId,
      tools,
      discoveries,
      context,
    );
    if (options.probe === false) return launch;
    const probeResult = await this.probe(
      launch,
      discoveries,
      context,
      parsers,
      options.environment ?? this.env,
      options.adapterId ?? "unknown",
      options.signal,
    );
    return this.withProbe(launch, probeResult);
  }

  async resolveLaunch(
    toolId: string,
    tools: RuleObject,
    discoveries: RuleObject,
    context: RuleObject,
  ): Promise<ResolvedTool> {
    return this.resolveTool(toolId, tools, discoveries, context, new Set());
  }

  async probe(
    tool: ResolvedTool,
    discoveries: RuleObject,
    context: RuleObject,
    parsers: RuleObject,
    environment: NodeJS.ProcessEnv,
    adapterId: string,
    signal?: AbortSignal,
    debugLog?: (message: string) => void,
  ): Promise<RuleObject> {
    const discovery = object(discoveries[tool.discoveryId]);
    const probe = object(discovery.probe);
    if (!Object.keys(probe).length) return {};
    const parserId = String(probe.parser);
    const parser = object(parsers[parserId]);
    if (!Object.keys(parser).length)
      throw new AdapterRuntimeError(
        "ADAPTER_TOOL_PROBE_FAILED",
        `Tool probe parser does not exist: ${parserId}`,
        false,
        [],
        { toolId: tool.toolId, parserId },
      );
    const args = (Array.isArray(probe.args) ? probe.args : []).map((value) =>
      String(renderRequiredTemplate(value, context, "tool probe") ?? ""),
    );
    const cacheKey = sha(
      stable({
        adapterId,
        platform: this.platform,
        toolId: tool.toolId,
        executable: tool.executable,
        argsPrefix: tool.argsPrefix,
        environment: Object.keys(environment)
          .sort()
          .map((key) => [key, environment[key]]),
        args,
      }),
    );
    const cached = this.probes.get(cacheKey);
    if (cached) return cached;
    const controller = new AbortController();
    const onAbort = () => controller.abort(signal?.reason);
    signal?.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(
      () => controller.abort({ kind: "probe-timeout" }),
      probeTimeoutMs(probe.timeout),
    );
    try {
      const execution = await runProcess({
        command: tool.executable,
        args: [...tool.argsPrefix, ...args],
        env: environment,
        signal: controller.signal,
        captureOutput: true,
        maxCaptureBytes: 4 * 1024 * 1024,
      });
      for (const [source, output] of [
        ["stdout", execution.stdout],
        ["stderr", execution.stderr],
      ] as const)
        for (const line of (output ?? "").split(/\r?\n/))
          if (line)
            debugLog?.(
              `Tool probe ${tool.toolId} ${source}: ${redactProbeOutput(line, environment)}`,
            );
      const parsed = parseOutput(
        parser,
        execution.stdout ?? "",
        execution.stderr ?? "",
        execution.code,
      );
      if (!parsed.success)
        throw new AdapterRuntimeError(
          "ADAPTER_TOOL_PROBE_FAILED",
          `Tool probe failed for ${tool.toolId}.`,
          parsed.error?.retryable === true,
          Array.isArray(parsed.error?.recovery)
            ? parsed.error.recovery.map(String)
            : [],
          { toolId: tool.toolId, exitCode: execution.code },
        );
      this.probes.set(cacheKey, parsed.result);
      return parsed.result;
    } catch (error) {
      if (controller.signal.aborted && !signal?.aborted)
        throw new AdapterRuntimeError(
          "ADAPTER_TOOL_PROBE_TIMEOUT",
          `Tool probe timed out for ${tool.toolId}.`,
          true,
          ["Retry the operation.", "Check that the tool can start promptly."],
          { toolId: tool.toolId },
        );
      if (error instanceof AdapterRuntimeError) throw error;
      throw new AdapterRuntimeError(
        "ADAPTER_TOOL_PROBE_FAILED",
        `Tool probe failed for ${tool.toolId}.`,
        false,
        [],
        { toolId: tool.toolId },
      );
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }
  }

  /** Probes every Tool in a via-tool chain exactly once, in dependency order. */
  async probeChain(
    tool: ResolvedTool,
    discoveries: RuleObject,
    context: RuleObject,
    parsers: RuleObject,
    environment: NodeJS.ProcessEnv,
    adapterId: string,
    signal?: AbortSignal,
    debugLog?: (message: string) => void,
  ): Promise<Map<string, RuleObject>> {
    const results = new Map<string, RuleObject>();
    for (const current of tool.chain) {
      const result = await this.probe(
        current as ResolvedTool,
        discoveries,
        context,
        parsers,
        environment,
        adapterId,
        signal,
        debugLog,
      );
      results.set(current.toolId, result);
    }
    return results;
  }

  private withProbe(tool: ResolvedTool, probeResult: RuleObject): ResolvedTool {
    return Object.keys(probeResult).length
      ? { ...tool, probeResult, probe: probeResult }
      : tool;
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
    try {
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
      );
      const renderContext = {
        ...context,
        discovery: { ...object(context.discovery), path: resolved.path },
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
              resolving,
            )
          : undefined;
      const executable = parent?.executable ?? resolved.path;
      const argsPrefix = [...(parent?.argsPrefix ?? []), ...ownPrefix];
      const current: ResolvedTool = {
        toolId,
        executable,
        argsPrefix,
        environmentId: String(
          launch.environment ?? parent?.environmentId ?? "inherit",
        ),
        discoveryId,
        discoveredPath: resolved.path,
        candidateId: resolved.candidateId,
        discoveryResult: {
          path: resolved.path,
          candidateId: resolved.candidateId,
        },
        id: toolId,
        path: executable,
        prefixArgs: argsPrefix,
        chain: [],
      };
      current.chain = [...(parent?.chain ?? []), current];
      return current;
    } finally {
      resolving.delete(toolId);
    }
  }

  private async resolveDiscovery(
    discoveryId: string,
    discovery: RuleObject,
    context: RuleObject,
  ): Promise<DiscoveryResolution> {
    const validation = object(discovery.validation);
    for (const { candidate } of candidateOrder(
      Array.isArray(discovery.candidates) ? discovery.candidates : [],
    )) {
      if (!platformEnabled(candidate, this.platform)) continue;
      const explicit = ["config", "config-path"].includes(
        String(candidate.type),
      );
      const result = await this.candidatePaths(candidate, context);
      // A missing optional configuration is not an invalid configuration:
      // continue to PATH/fixed candidates. A supplied but invalid value is
      // deliberately terminal so a typo cannot silently select another tool.
      if (explicit && !result.configured) continue;
      for (const candidatePath of result.paths) {
        const resolved = await validatePath(
          candidatePath,
          validation,
          this.platform,
        );
        if (resolved)
          return { path: resolved, candidateId: String(candidate.id) };
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

  private async candidatePaths(
    candidate: RuleObject,
    context: RuleObject,
  ): Promise<CandidatePaths> {
    const type = String(candidate.type);
    if (type === "config" || type === "config-path") {
      const value = lookup(object(context.config), String(candidate.key));
      if (typeof value !== "string" || !value.trim())
        return { configured: false, paths: [] };
      const append = Array.isArray(candidate.append)
        ? candidate.append.map(String)
        : [];
      return { configured: true, paths: [path.resolve(value, ...append)] };
    }
    if (type === "environment" || type === "environment-path") {
      const value = envValue(
        this.env,
        String(candidate.variable),
        this.platform,
      );
      if (!value) return { configured: false, paths: [] };
      const append = Array.isArray(candidate.append)
        ? candidate.append.map(String)
        : [];
      return { configured: true, paths: [path.resolve(value, ...append)] };
    }
    if (type === "path") {
      const directories = (
        envValue(this.env, "PATH", this.platform) || ""
      ).split(path.delimiter);
      const names = pathNames(
        Array.isArray(candidate.names) ? candidate.names : [],
        this.env,
        this.platform,
      );
      return {
        configured: true,
        paths: directories.flatMap((directory) =>
          names.map((name) => path.resolve(directory || ".", name)),
        ),
      };
    }
    if (type === "fixed")
      return {
        configured: true,
        paths: (Array.isArray(candidate.paths) ? candidate.paths : []).map(
          (item) =>
            path.resolve(
              String(renderRequiredTemplate(item, context, "tool path") ?? ""),
            ),
        ),
      };
    if (type === "glob") {
      const matches: string[] = [];
      for (const pattern of Array.isArray(candidate.patterns)
        ? candidate.patterns
        : [])
        for await (const match of glob(
          String(renderRequiredTemplate(pattern, context, "tool glob") ?? ""),
        ))
          matches.push(path.resolve(match));
      return {
        configured: true,
        paths: matches.sort((left, right) => left.localeCompare(right)),
      };
    }
    return { configured: true, paths: [] };
  }
}
