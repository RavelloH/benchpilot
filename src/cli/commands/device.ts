import { BenchPilotError, type Capability } from "../../core.js";
import type { DeviceUseCases } from "../../application/devices/use-case.js";
import type { CommandCatalog } from "../../application/commands/catalog.js";
import { capabilityInput, type RawOption } from "../option-parser.js";
import type { Flags } from "../parser.js";
import { capabilityResultFromOperation } from "../output/capability-result.js";
import { renderCapabilityResult } from "../output/capability-renderer.js";
import type { DeferredOperationReporter } from "../output/deferred-operation-reporter.js";
import type { Locale } from "../../i18n/index.js";
import type { AdapterCapabilityView } from "../../adapters/contract/views.js";
import type {
  ManagedSessionIdentity,
  ManagedSessionLogRecord,
  ManagedSessionPlan,
} from "../../core.js";
import { CommandResultV3 } from "../../contracts/index.js";
import stripAnsi from "strip-ansi";

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
  confirmApproval?: () => Promise<boolean>;
  requiresApproval?: (
    mode: "normal" | "caution" | "destructive" | "irreversible",
  ) => boolean;
  reporter?: DeferredOperationReporter;
  output: { write(value: string): unknown };
  locale: Locale;
  color: boolean;
  columns: number;
  console?: (input: {
    identity: ManagedSessionIdentity;
    plan: ManagedSessionPlan;
    sessionId?: string;
  }) => Promise<void>;
  followLogs?: (input: {
    device: string;
    capability: string;
    sessionId?: string;
    tail?: number;
    cursor?: string;
    signal: AbortSignal;
  }) => AsyncIterable<ManagedSessionLogRecord>;
}

export async function handleDeviceCommand({
  parts,
  flags,
  rawOptions,
  devices,
  catalog,
  localizeCapabilities,
  renderHelp,
  confirmApproval,
  requiresApproval,
  reporter,
  output,
  locale,
  color,
  columns,
  console: consoleHandler,
  followLogs,
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
      parts.slice(3),
    );
    const approvalRequired =
      requiresApproval?.(definition.safety.mode) === true;
    if (approvalRequired && confirmApproval && !(await confirmApproval()))
      return true;
    const interactiveExecution =
      approvalRequired && confirmApproval !== undefined;
    if (input.follow === true) {
      if (flags.json)
        throw new BenchPilotError(
          "MANAGED_SESSION_FOLLOW_JSON_UNSUPPORTED",
          2,
          "Managed session log follow requires Screen or JSONL output.",
        );
      if (!followLogs)
        throw new BenchPilotError(
          "MANAGED_SESSION_FOLLOW_UNAVAILABLE",
          5,
          "Managed session log follow is unavailable for this capability.",
        );
      const command = {
        id: "device.execute",
        path: ["device", parts[1], capability],
      };
      const started = new Date();
      const controller = new AbortController();
      const onSigint = () => controller.abort();
      process.once("SIGINT", onSigint);
      reporter?.configure(command);
      let cursor = typeof input.cursor === "string" ? input.cursor : undefined;
      try {
        for await (const record of followLogs({
          device: parts[1],
          capability,
          ...(typeof input.session_id === "string"
            ? { sessionId: input.session_id }
            : {}),
          ...(typeof input.tail === "number" ? { tail: input.tail } : {}),
          ...(cursor ? { cursor } : {}),
          signal: controller.signal,
        })) {
          cursor = `1:${record.sequence}`;
          if (flags.jsonl) reporter?.emit("session.log.append", { record });
          else if (record.text !== undefined)
            output.write(
              `${stripAnsi(record.text).replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, "")}\n`,
            );
          else if (record.base64)
            output.write(
              `[binary ${Buffer.from(record.base64, "base64").byteLength} bytes]\n`,
            );
        }
      } finally {
        process.removeListener("SIGINT", onSigint);
      }
      const ended = new Date();
      const result: CommandResultV3 = {
        schema: "benchpilot.result",
        version: 3,
        ok: true,
        command,
        kind: "operation",
        data: {
          schema: "benchpilot.session-log-follow",
          version: 1,
          status: "detached",
          ...(cursor ? { cursor } : {}),
        },
        meta: {
          startedAt: started.toISOString(),
          endedAt: ended.toISOString(),
          durationMs: Math.max(0, ended.getTime() - started.getTime()),
        },
      };
      if (flags.jsonl)
        reporter?.complete({ type: "command.completed", result });
      return true;
    }
    if (definition.ttyOnly) {
      if (!consoleHandler)
        throw new BenchPilotError(
          "INTERACTIVE_TERMINAL_REQUIRED",
          2,
          "Interactive terminal is required for this managed session capability.",
        );
    }
    const command = {
      id: "device.execute",
      path: ["device", parts[1], capability],
    };
    reporter?.configure(command);
    const outcome = await devices.executeDetailed({
      device: parts[1],
      capability,
      capabilityInput: input,
      ...(interactiveExecution
        ? { executionMode: "interactive" as const }
        : {}),
      ...(definition.ttyOnly && consoleHandler
        ? { attachManagedSessionConsole: consoleHandler }
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
