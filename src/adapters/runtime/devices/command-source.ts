import { tmpdir } from "node:os";
import { AdapterRuntimeError } from "../errors.js";
import { EnvironmentResolver } from "../environments/resolver.js";
import { executeProcess } from "../executors/process-executor.js";
import { durationMs, planLaunch } from "../planning/launch-plan.js";
import { object, type RuleObject } from "../rules/template.js";
import { ToolResolver } from "../tools/resolver.js";
import type { RuntimeAdapter } from "../types.js";

/**
 * Runs a declared Discovery command through a normal process Action. The
 * adapter cannot provide a shell string: Action schema validation still owns
 * the executable, arguments, tool chain, parser, and environment rules.
 */
export const executeDeviceCommandSource = async (
  runtime: RuntimeAdapter,
  adapterConfig: RuleObject,
  source: RuleObject,
): Promise<RuleObject[]> => {
  const actionId = String(source.action);
  const action = object(object(runtime.rules.actions)[actionId]);
  if (action.type !== "process")
    throw new AdapterRuntimeError(
      "ADAPTER_DISCOVERY_FAILED",
      "A command device source requires a process Action.",
      false,
      ["Use a passive source or configure a process Action."],
      { source: source.id, actionId },
    );
  const parserId = String(action.parser);
  const parser = object(object(runtime.rules.parsers)[parserId]);
  if (!Object.keys(parser).length)
    throw new AdapterRuntimeError(
      "ADAPTER_DISCOVERY_FAILED",
      "A command device source Action requires a Parser.",
      false,
      [],
      { source: source.id, actionId, parserId },
    );
  const context: RuleObject = {
    adapter: {
      id: runtime.bundle.id,
      version: String(runtime.bundle.manifest.adapter_version),
      manifest: runtime.bundle.manifest,
    },
    platform: runtime.platform,
    config: adapterConfig,
    device: {},
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
    object(runtime.rules.tools),
    object(runtime.rules.discoveries),
    context,
    object(runtime.rules.parsers),
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
    object(runtime.rules.environments),
    context,
    new AbortController().signal,
  );
  const probes = await tools.probeChain(
    tool,
    object(runtime.rules.discoveries),
    context,
    object(runtime.rules.parsers),
    environment.environment,
    runtime.bundle.id,
  );
  for (const current of tool.chain) {
    const probe = probes.get(current.toolId) ?? {};
    if (Object.keys(probe).length) {
      (context.tool as Record<string, RuleObject>)[current.toolId]!.probe =
        probe;
      (context.discovery as Record<string, RuleObject>)[
        current.discoveryId
      ]!.probe = probe;
    }
  }
  const plan = planLaunch(action, context, tool, environment.environment);
  if (plan.kind !== "process")
    throw new AdapterRuntimeError(
      "ADAPTER_DISCOVERY_FAILED",
      "A command device source is not a process launch.",
    );
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort({ kind: "device-discovery-timeout" }),
    Math.min(10_000, durationMs(action.timeout, 10_000)),
  );
  try {
    const execution = await executeProcess(plan, parser, controller.signal);
    const records = execution.result[String(source.result)];
    if (
      !Array.isArray(records) ||
      records.some(
        (record) =>
          !record || typeof record !== "object" || Array.isArray(record),
      )
    )
      throw new AdapterRuntimeError(
        "ADAPTER_DISCOVERY_FAILED",
        "Command device source did not return an array of device records.",
        false,
        [],
        { source: source.id, result: source.result },
      );
    return records.map(object);
  } catch (error) {
    if (controller.signal.aborted)
      throw new AdapterRuntimeError(
        "ADAPTER_DISCOVERY_FAILED",
        "Command device source timed out.",
        true,
        ["Retry the scan after the discovery tool is available."],
        { source: source.id },
      );
    throw error;
  } finally {
    clearTimeout(timer);
  }
};
