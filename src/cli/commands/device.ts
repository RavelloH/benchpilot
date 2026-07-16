import { stdout } from "node:process";
import {
  type AdapterRegistry,
  fail,
  type Json,
  type OperationRunner,
  type PathService,
  type ResolvedConfig,
} from "../../core.js";
import {
  capabilityInput,
  optionEnabled,
  type RawOption,
} from "../option-parser.js";
import type { Flags } from "../parser.js";
import { write } from "../output-renderer.js";

interface DeviceCommandContext {
  parts: string[];
  flags: Flags;
  rawOptions: RawOption[];
  registry: AdapterRegistry;
  runner: OperationRunner;
  config: ResolvedConfig;
  paths: PathService;
}

export async function handleDeviceCommand({
  parts,
  flags,
  rawOptions,
  registry,
  runner,
  config,
  paths,
}: DeviceCommandContext): Promise<boolean> {
  if (parts[0] === "device" && parts[1]) {
    const rawDevice = (config.value.devices as Json | undefined)?.[parts[1]];
    if (!rawDevice || typeof rawDevice !== "object")
      fail("DEVICE_NOT_FOUND", 3, `Device not found: ${parts[1]}`);
    const adapter = registry.get(String((rawDevice as Json).adapter));
    const runtime = await registry.createDevice(
      adapter,
      parts[1],
      rawDevice as Json,
      config.value,
      paths,
    );
    if (parts.length === 2) {
      stdout.write(
        `benchpilot device ${parts[1]} — ${adapter.summary}\n\nCommands:\n${runtime
          .capabilities()
          .map((x) => `  ${x.id.padEnd(17)} ${x.summary}`)
          .join("\n")}\n`,
      );
      return true;
    }
    const capability = parts[2];
    if (!runtime.capabilities().some((item) => item.id === capability))
      fail(
        "UNSUPPORTED_CAPABILITY",
        3,
        `Device ${parts[1]} does not support ${capability}.`,
      );
    const definition = runtime
      .capabilities()
      .find((item) => item.id === capability)!;
    if (flags.help) {
      const help = {
        schema: "benchpilot.help",
        version: 1,
        path: parts,
        summary: definition.summary,
        description: definition.description || definition.summary,
        options: (definition.options || []).filter(
          (option) => option.hidden !== true,
        ),
        inputSchema: definition.inputSchema?.describe() || { type: "object" },
        outputSchema: definition.outputSchema?.describe() || {
          type: "object",
        },
        safety: definition.safety,
      };
      write(help, flags, `${definition.id} — ${definition.summary}\n`);
      return true;
    }
    const input = capabilityInput(
      rawOptions,
      definition.options || [],
      definition.safety.flag,
      parts.slice(3),
    );
    if (definition.safety.mode !== "normal" && definition.safety.flag)
      flags[definition.safety.flag] = optionEnabled(
        rawOptions,
        definition.safety.flag,
      );
    const result = await runner.execute(parts[1], capability, input);
    const r = result as Json;
    write(
      result,
      flags,
      r.dryRun
        ? `${capability} dry-run plan created.`
        : `${capability} completed${r.runId ? ` (run ${String(r.runId)})` : ""}.`,
    );
    return true;
  }
  return false;
}
