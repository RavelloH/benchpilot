import { stdout } from "node:process";
import type { Json } from "../core.js";
import { t, type Locale, type MessageKey } from "../i18n/index.js";
import { renderDataPage } from "./data-renderer.js";
import type { CliDataPage } from "./data/page.js";
import type { Flags } from "./parser.js";
import {
  jsonlPresentation,
  jsonPresentation,
  screenPresentation,
  type CliNode,
  type PresentationJsonlComplete,
  type PresentationJsonlSnapshot,
  type PresentationJsonlStart,
  type PresentationView,
} from "./presentation/page.js";

export interface OutputSink {
  stdout: { write(value: string): unknown };
  stderr: { write(value: string): unknown };
}

export const processOutputSink: OutputSink = {
  stdout,
  stderr: process.stderr,
};

const machineResult = (value: unknown): Json => {
  if (
    value &&
    typeof value === "object" &&
    ((value as Json).schema === "benchpilot.result" ||
      (value as Json).schema === "benchpilot.help" ||
      (value as Json).schema === "benchpilot.help-index")
  )
    return value as Json;
  return {
    schema: "benchpilot.result",
    version: 2,
    ok: true,
    kind: "COMMAND_COMPLETED",
    data: value as Json,
  };
};

export function write(
  value: unknown,
  flags: Flags,
  plain?: string,
  sink: OutputSink = processOutputSink,
) {
  const machine = machineResult(value);
  const operation =
    machine &&
    typeof machine === "object" &&
    machine.schema === "benchpilot.result" &&
    machine.kind !== "COMMAND_COMPLETED" &&
    machine.dryRun !== true;
  sink.stdout.write(
    flags.json
      ? `${JSON.stringify(machine)}\n`
      : flags.jsonl
        ? operation
          ? ""
          : `${JSON.stringify({ schema: "benchpilot.event", version: 2, event: { type: "command.result", timestamp: new Date().toISOString() }, context: {}, data: { result: machine } })}\n`
        : (plain ?? `${JSON.stringify(value, null, 2)}\n`),
  );
}

export function writeText(value: string, sink: OutputSink = processOutputSink) {
  sink.stdout.write(value);
}

/** The only stdout writer for canonical command data. */
export function writeDataPage<T extends object>(input: {
  readonly page: CliDataPage<T>;
  readonly flags: Flags;
  readonly locale: Locale;
  readonly view: PresentationView;
  readonly color: boolean;
  readonly sink?: OutputSink;
}) {
  (input.sink ?? processOutputSink).stdout.write(renderDataPage(input));
}

/** The only stdout writer for presentation pages. */
export function writePresentation(input: {
  readonly nodes: readonly CliNode[];
  readonly flags: Flags;
  readonly locale: Locale;
  readonly view: PresentationView;
  readonly sink?: OutputSink;
}) {
  const sink = input.sink ?? processOutputSink;
  if (input.flags.json) {
    sink.stdout.write(`${JSON.stringify(jsonPresentation(input.nodes))}\n`);
    return;
  }
  if (input.flags.jsonl) {
    const snapshots = jsonlPresentation(input.nodes);
    const records: readonly (
      | PresentationJsonlStart
      | PresentationJsonlSnapshot
      | PresentationJsonlComplete
    )[] = [
      {
        op: "start",
        protocol: "benchpilot.presentation",
        version: 1,
        locale: input.locale,
        view: input.view,
      },
      ...snapshots,
      { op: "complete", count: snapshots.length },
    ];
    sink.stdout.write(
      `${records.map((record) => JSON.stringify(record)).join("\n")}\n`,
    );
    return;
  }
  sink.stdout.write(screenPresentation(input.nodes));
}

export function writeFailure(input: {
  result: unknown;
  flags: Flags;
  isOperation: boolean;
  terminalEmitted: boolean;
  humanMessage: string;
  help?: string;
  sink?: OutputSink;
}) {
  const sink = input.sink ?? processOutputSink;
  if (input.flags.json) {
    sink.stdout.write(`${JSON.stringify(input.result)}\n`);
    return;
  }
  if (input.flags.jsonl && !input.terminalEmitted) {
    sink.stdout.write(
      `${JSON.stringify({ schema: "benchpilot.event", version: 2, event: { type: input.isOperation ? "operation.failed" : "command.failed", timestamp: new Date().toISOString() }, context: {}, data: { error: input.result } })}\n`,
    );
    return;
  }
  sink.stderr.write(`${input.humanMessage}\n`);
  if (input.help) sink.stderr.write(`\n${input.help}\n`);
}

const errorMessageKey = (kind: string): MessageKey => {
  if (/^(USAGE|INVALID_)/.test(kind)) return "error.usage";
  if (/^(CONFIG|PROJECT|UNKNOWN_ADAPTER|ADAPTER_)/.test(kind))
    return "error.configuration";
  if (/^(DEVICE|UNSUPPORTED_CAPABILITY)/.test(kind)) return "error.device";
  if (/^SYSTEM/.test(kind)) return "error.system";
  if (/^(LOCK|DEVICE_BUSY)/.test(kind)) return "error.lock";
  if (/^(APPROVAL|HUMAN_APPROVAL|DANGEROUS_CONFIRMATION)/.test(kind))
    return "error.approval";
  if (/^(OPERATION|CLEANUP|INVALID_ARTIFACT)/.test(kind))
    return "error.operation";
  if (/^UPGRADE/.test(kind)) return "error.upgrade";
  if (/^(INTERACTION|AGENT_INTERACTION|INTERACTIVE_)/.test(kind))
    return "error.interaction";
  if (kind === "INTERNAL_ERROR") return "error.internal";
  return "error.unknown";
};

const errorReasonKeys: Partial<Record<string, MessageKey>> = {
  PROJECT_NOT_FOUND: "error.reason.projectNotFound",
  CONFIG_EXISTS: "error.reason.configExists",
  CONFIG_KEY_NOT_FOUND: "error.reason.configKeyNotFound",
  INVALID_CONFIG: "error.reason.invalidConfig",
  INVALID_TOML: "error.reason.invalidToml",
  UNSUPPORTED_CONFIG_VERSION: "error.reason.unsupportedConfigVersion",
  APPROVAL_NOT_FOUND: "error.reason.approvalNotFound",
  APPROVAL_STATE_INVALID: "error.reason.approvalStateInvalid",
  APPROVAL_EXPIRED: "error.reason.approvalExpired",
  APPROVAL_ALREADY_CLAIMED: "error.reason.approvalAlreadyClaimed",
  APPROVAL_CHALLENGE_FAILED: "error.reason.approvalChallengeFailed",
  APPROVAL_CHALLENGE_UNAVAILABLE: "error.reason.approvalChallengeUnavailable",
  HUMAN_APPROVAL_REQUIRED: "error.reason.humanApprovalRequired",
  DANGEROUS_CONFIRMATION_REQUIRED: "error.reason.dangerousConfirmationRequired",
  DEVICE_NOT_FOUND: "error.reason.deviceNotFound",
  DEVICE_BUSY: "error.reason.deviceBusy",
  DEVICE_IDENTITY_UNAVAILABLE: "error.reason.deviceIdentityUnavailable",
  DEVICE_QUARANTINED: "error.reason.deviceQuarantined",
  UNSUPPORTED_CAPABILITY: "error.reason.unsupportedCapability",
  SYSTEM_NOT_FOUND: "error.reason.systemNotFound",
  SYSTEM_CAPABILITY_UNAVAILABLE: "error.reason.systemCapabilityUnavailable",
  LOCK_NOT_FOUND: "error.reason.lockNotFound",
  LOCK_QUARANTINED: "error.reason.lockQuarantined",
  LOCK_OWNERSHIP_LOST: "error.reason.lockOwnershipLost",
  UNKNOWN_COMMAND: "error.reason.unknownCommand",
  UNKNOWN_ADAPTER: "error.reason.unknownAdapter",
  ADAPTER_NOT_FOUND: "error.reason.adapterNotFound",
  OPERATION_TIMEOUT: "error.reason.operationTimeout",
  OPERATION_ABORTED: "error.reason.operationAborted",
  CLEANUP_FAILED: "error.reason.cleanupFailed",
  CLEANUP_TIMEOUT: "error.reason.cleanupTimeout",
  INTERACTION_CANCELLED: "error.reason.interactionCancelled",
  AGENT_INTERACTION_UNSUPPORTED: "error.reason.agentInteractionUnsupported",
  INTERACTIVE_TERMINAL_REQUIRED: "error.reason.interactiveTerminalRequired",
  INTERACTIVE_MACHINE_OUTPUT_UNSUPPORTED:
    "error.reason.interactiveMachineOutputUnsupported",
  UPGRADE_INSTALLATION_NOT_FOUND: "error.reason.upgradeInstallationNotFound",
  UPGRADE_PACKAGE_MANAGER_NOT_FOUND:
    "error.reason.upgradePackageManagerNotFound",
  UPGRADE_REGISTRY_UNAVAILABLE: "error.reason.upgradeRegistryUnavailable",
  UPGRADE_VERSION_NOT_FOUND: "error.reason.upgradeVersionNotFound",
  UPGRADE_FAILED: "error.reason.upgradeFailed",
  DUPLICATE_ADAPTER: "error.reason.duplicateAdapter",
  INTERNAL_ERROR: "error.reason.internalError",
  INVALID_ADAPTER_DEFINITION: "error.reason.invalidAdapterDefinition",
  INVALID_APPROVAL_ID: "error.reason.invalidApprovalId",
  INVALID_ARTIFACT: "error.reason.invalidArtifact",
  INVALID_DEVICE_CONFIG: "error.reason.invalidDeviceConfig",
  INVALID_DURATION: "error.reason.invalidDuration",
  INVALID_LOCK_ID: "error.reason.invalidLockId",
  INVALID_PATH: "error.reason.invalidPath",
  INVALID_PROJECT_NAME: "error.reason.invalidProjectName",
  INVALID_RUN_ID: "error.reason.invalidRunId",
  LOCK_CORRUPT: "error.reason.lockCorrupt",
  USAGE_ERROR: "error.reason.usageError",
};

const localizedErrorReason = (
  locale: Locale,
  kind: string,
  fallback: string,
) => {
  const key = errorReasonKeys[kind];
  if (key) return t(locale, key);
  // Adapter and operating-system diagnostics can be free-form. Keep English
  // details in machine output, while ensuring human Chinese output never
  // falls back to an untranslated message.
  if (locale === "zh-CN")
    return t(locale, "error.reason.untranslated", { kind });
  return fallback;
};

/** Human-only localization; machine DTO messages are deliberately untouched. */
export const humanErrorMessage = (
  locale: Locale,
  kind: string,
  fallback: string,
) =>
  t(locale, errorMessageKey(kind), {
    message: localizedErrorReason(locale, kind, fallback),
  });
