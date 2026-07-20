import type { Capability } from "../../core.js";
import type { DeviceUseCases } from "../../application/devices/use-case.js";
import type { CommandCatalog } from "../../application/commands/catalog.js";
import {
  capabilityInput,
  optionEnabled,
  type RawOption,
} from "../option-parser.js";
import type { Flags } from "../parser.js";
import { capabilityResultFromOperation } from "../output/capability-result.js";
import { renderCapabilityResult } from "../output/capability-renderer.js";
import type { DeferredOperationReporter } from "../output/deferred-operation-reporter.js";
import type { Locale } from "../../i18n/index.js";
import type { AdapterCapabilityView } from "../../adapters/contract/views.js";

type AdapterWithCapabilityViews = {
  readonly capabilityViews?: Readonly<Record<string, AdapterCapabilityView>>;
};

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
  reporter?: DeferredOperationReporter;
  output: { write(value: string): unknown };
  locale: Locale;
  color: boolean;
  columns: number;
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
  reporter,
  output,
  locale,
  color,
  columns,
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
    const command = {
      id: "device.execute",
      path: ["device", parts[1], capability],
    };
    reporter?.configure(command);
    const outcome = await devices.executeDetailed({
      device: parts[1],
      capability,
      capabilityInput: input,
      safetyConfirmed,
      ...(interactiveExecution
        ? { executionMode: "interactive" as const }
        : {}),
    });
    const result = capabilityResultFromOperation({ command, outcome });
    renderCapabilityResult({
      result,
      flags,
      output,
      reporter,
      locale,
      color,
      columns,
      view: (resolved.adapter as AdapterWithCapabilityViews).capabilityViews?.[
        capability
      ],
      adapterId: resolved.adapter.id,
      translate: resolved.adapter.translate,
    });
    if (!result.ok) process.exitCode = outcome.primaryError?.exitCode ?? 5;
    return true;
  }
  return false;
}
