import type { Json } from "../../core.js";
import type { DeviceUseCases } from "../../application/devices/use-case.js";
import type { CommandCatalog } from "../../application/commands/catalog.js";
import {
  capabilityInput,
  optionEnabled,
  type RawOption,
} from "../option-parser.js";
import type { Flags } from "../parser.js";
import { write } from "../output-renderer.js";
import { t, type Locale } from "../../i18n/index.js";

interface DeviceCommandContext {
  parts: string[];
  flags: Flags;
  rawOptions: RawOption[];
  devices: DeviceUseCases;
  catalog: CommandCatalog;
  locale: Locale;
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
  locale,
  confirmSafety,
  confirmApproval,
  requiresApproval,
}: DeviceCommandContext): Promise<boolean> {
  if (parts[0] === "device" && parts[1]) {
    const device = await devices.describe(parts[1], locale);
    if (parts.length === 2) {
      const help = {
        schema: "benchpilot.help" as const,
        version: 2 as const,
        path: parts,
        summary: device.adapter.summary,
        description: device.adapter.summary,
        options: [],
        inputSchema: { type: "object" },
        outputSchema: { type: "object" },
        safety: { mode: "normal" },
      };
      write(
        help,
        flags,
        `benchpilot device ${parts[1]} — ${device.adapter.summary}\n\n${t(locale, "help.commands")}:\n${device.capabilities
          .map((x) => `  ${x.id.padEnd(17)} ${x.summary}`)
          .join("\n")}\n`,
      );
      return true;
    }
    const capability = parts[2];
    const { capability: definition } = await devices.capability(
      parts[1],
      capability,
      locale,
    );
    if (flags.help) {
      const help = {
        schema: "benchpilot.help",
        version: 2,
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
    await catalog.executable(["device", parts[1], capability]);
    const input = capabilityInput(
      rawOptions,
      definition.options || [],
      definition.safety.flag,
      parts.slice(3),
    );
    const interactiveExecution =
      definition.safety.mode !== "normal" && confirmSafety !== undefined;
    if (definition.safety.mode !== "normal" && definition.safety.flag) {
      if (confirmSafety) {
        if (!(await confirmSafety())) return true;
      } else
        flags[definition.safety.flag] = optionEnabled(
          rawOptions,
          definition.safety.flag,
        );
    }
    const approvalRequired =
      requiresApproval?.(definition.safety.mode) === true;
    if (approvalRequired && confirmApproval && !(await confirmApproval()))
      return true;
    const result = await devices.execute({
      device: parts[1],
      capability,
      capabilityInput: input,
      ...(interactiveExecution
        ? { executionMode: "interactive" as const }
        : {}),
    });
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
