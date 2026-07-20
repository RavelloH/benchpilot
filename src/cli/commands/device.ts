import type { Capability, Json } from "../../core.js";
import type { DeviceUseCases } from "../../application/devices/use-case.js";
import type { CommandCatalog } from "../../application/commands/catalog.js";
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
  devices: DeviceUseCases;
  catalog: CommandCatalog;
  localizeCapabilities: (
    adapterId: string,
    capabilities: readonly Capability[],
  ) => Capability[];
  renderHelp: (path: readonly string[], includeAll?: boolean) => Promise<void>;
  confirmSafety?: () => Promise<boolean>;
  confirmApproval?: () => Promise<boolean>;
  requiresApproval?: (
    mode: "normal" | "caution" | "destructive" | "irreversible",
  ) => boolean;
}

export async function handleDeviceCommand({
  parts,
  flags,
  rawOptions,
  devices,
  catalog,
  localizeCapabilities,
  renderHelp,
  confirmSafety,
  confirmApproval,
  requiresApproval,
}: DeviceCommandContext): Promise<boolean> {
  if (parts[0] === "device" && parts[1]) {
    if (parts.length === 2) {
      await renderHelp(parts, true);
      return true;
    }
    const capability = parts[2];
    const resolved = await devices.capability(parts[1], capability);
    const definition = localizeCapabilities(resolved.adapter.id, [
      resolved.capability,
    ])[0]!;
    if (flags.help) {
      await renderHelp(parts, true);
      return true;
    }
    await catalog.executable(["device", parts[1], capability]);
    const input = capabilityInput(
      rawOptions,
      definition.options || [],
      definition.safety.flag,
      parts.slice(3),
    );
    const interactiveExecution =
      definition.safety.mode !== "normal" && confirmSafety !== undefined;
    let safetyConfirmed = definition.safety.mode === "normal";
    if (definition.safety.mode !== "normal" && definition.safety.flag) {
      if (confirmSafety) {
        if (!(await confirmSafety())) return true;
        safetyConfirmed = true;
      } else
        safetyConfirmed = optionEnabled(rawOptions, definition.safety.flag);
    }
    const approvalRequired =
      requiresApproval?.(definition.safety.mode) === true;
    if (approvalRequired && confirmApproval && !(await confirmApproval()))
      return true;
    const result = await devices.execute({
      device: parts[1],
      capability,
      capabilityInput: input,
      safetyConfirmed,
      ...(interactiveExecution
        ? { executionMode: "interactive" as const }
        : {}),
    });
    const r = result as Json;
    if (capability === "info" && !flags.json && !flags.jsonl)
      write(result, flags, `${JSON.stringify(r.data ?? {}, null, 2)}\n`);
    else
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
