import { tmpdir } from "node:os";
import { AdapterRuntimeError } from "../errors.js";
import { EnvironmentResolver } from "../environments/resolver.js";
import { executeProcess } from "../executors/process-executor.js";
import { durationMs, planLaunch } from "../planning/launch-plan.js";
import { object, type RuleObject } from "../rules/template.js";
import { ToolResolver } from "../tools/resolver.js";
import type { RuntimeAdapter } from "../types.js";

export interface DeviceProbeOutcome {
  ok: boolean;
  result?: RuleObject;
  error?: { kind: string; retryable: boolean };
}

const environmentSummary = (environment: NodeJS.ProcessEnv) =>
  Object.fromEntries(
    Object.entries(environment).map(([key, value]) => [
      key,
      value === undefined ? undefined : "[RESOLVED]",
    ]),
  );

/**
 * Executes a declared, explicitly requested Device Probe without creating a
 * Core Run or opening a serial connection. Callers gate destructive probes
 * before invoking this helper.
 */
export const executeDeviceProbe = async (
  runtime: RuntimeAdapter,
  adapterConfig: RuleObject,
  device: RuleObject,
): Promise<DeviceProbeOutcome> => {
  const rules = runtime.rules;
  const probe = object(object(rules.devices).probe);
  const actionId = String(probe.action);
  const action = object(object(rules.actions)[actionId]);
  const parserId = String(probe.parser);
  const parser = object(object(rules.parsers)[parserId]);
  if (action.type !== "process")
    throw new AdapterRuntimeError(
      "ADAPTER_EXECUTOR_UNAVAILABLE",
      "Device probes currently require a process Action.",
      false,
      ["Use a passive source or a process-based probe."],
      { actionId },
    );
  if (!Object.keys(parser).length)
    throw new AdapterRuntimeError(
      "ADAPTER_DISCOVERY_FAILED",
      "Device probe parser does not exist.",
      false,
      [],
      { parserId },
    );
  const context: RuleObject = {
    adapter: {
      id: runtime.bundle.id,
      version: String(runtime.bundle.manifest.adapter_version),
      manifest: runtime.bundle.manifest,
    },
    platform: runtime.platform,
    config: adapterConfig,
    device,
    input: {},
    project: { root: process.cwd() },
    home: process.env.HOME ?? process.env.USERPROFILE ?? "",
    temp: tmpdir(),
    env: process.env,
    tool: {},
    discovery: {},
    environment: {},
    result: {},
  };
  const tools = new ToolResolver(runtime.platform, process.env);
  const tool = await tools.resolve(
    String(action.tool),
    object(rules.tools),
    object(rules.discoveries),
    context,
    object(rules.parsers),
    { probe: false, adapterId: runtime.bundle.id },
  );
  const environments = new EnvironmentResolver();
  for (const current of tool.chain) {
    (context.tool as Record<string, RuleObject>)[current.toolId] = {
      executable: current.executable,
      argsPrefix: current.argsPrefix,
      environmentId: current.environmentId,
      discoveryId: current.discoveryId,
      discoveredPath: current.discoveredPath,
    };
    (context.discovery as Record<string, RuleObject>)[current.discoveryId] = {
      path: current.discoveredPath,
      candidateId: current.candidateId,
    };
  }
  const environment = await environments.resolveDetailed(
    tool.environmentId,
    object(rules.environments),
    context,
    new AbortController().signal,
  );
  const probes = await tools.probeChain(
    tool,
    object(rules.discoveries),
    context,
    object(rules.parsers),
    environment.environment,
    runtime.bundle.id,
  );
  for (const current of tool.chain) {
    const toolProbe = probes.get(current.toolId) ?? {};
    if (Object.keys(toolProbe).length) {
      (context.tool as Record<string, RuleObject>)[current.toolId]!.probe =
        toolProbe;
      (context.discovery as Record<string, RuleObject>)[
        current.discoveryId
      ]!.probe = toolProbe;
    }
  }
  (context.environment as Record<string, RuleObject>)[tool.environmentId] = {
    providerId: environment.providerId,
    strategy: environment.strategy,
    source: environment.source,
    variables: environmentSummary(environment.environment),
  };
  const plan = planLaunch(
    { ...action, parser: parserId },
    context,
    tool,
    environment.environment,
  );
  if (plan.kind !== "process")
    throw new AdapterRuntimeError(
      "ADAPTER_EXECUTOR_UNAVAILABLE",
      "Device probe is not a process launch.",
    );
  const controller = new AbortController();
  const timeoutMs = Math.min(10_000, durationMs(action.timeout, 10_000));
  const timer = setTimeout(
    () => controller.abort({ kind: "device-probe-timeout" }),
    timeoutMs,
  );
  try {
    const execution = await executeProcess(plan, parser, controller.signal);
    return { ok: true, result: execution.result };
  } catch (error) {
    if (controller.signal.aborted)
      return {
        ok: false,
        error: { kind: "ADAPTER_TOOL_PROBE_TIMEOUT", retryable: true },
      };
    if (error instanceof AdapterRuntimeError)
      return {
        ok: false,
        error: { kind: error.code, retryable: error.retryable },
      };
    return {
      ok: false,
      error: { kind: "ADAPTER_DISCOVERY_FAILED", retryable: false },
    };
  } finally {
    clearTimeout(timer);
  }
};
