import { messageRef, type MessageRef } from "../../contracts/message-ref.js";

export type ErrorCategoryKey =
  | "error.approval"
  | "error.configuration"
  | "error.device"
  | "error.interaction"
  | "error.internal"
  | "error.lock"
  | "error.operation"
  | "error.safety"
  | "error.system"
  | "error.upgrade"
  | "error.usage";

export interface CoreErrorDefinition {
  readonly exitCode: number;
  readonly category: MessageRef<ErrorCategoryKey>;
  readonly reason: MessageRef<`error.reason.${string}`>;
  readonly retryable: boolean;
  readonly recovery: readonly MessageRef[];
  readonly detailsSchema: {
    readonly type: "object";
    readonly additionalProperties: true;
  };
}

const defineError = (
  exitCode: number,
  categoryKey: ErrorCategoryKey,
  reasonKey: `error.reason.${string}`,
  retryable = false,
): CoreErrorDefinition => ({
  exitCode,
  category: messageRef(categoryKey),
  reason: messageRef(reasonKey),
  retryable,
  recovery: [],
  detailsSchema: { type: "object", additionalProperties: true },
});

export const coreErrorCatalog = {
  USAGE_ERROR: defineError(2, "error.usage", "error.reason.usageError"),
  UNKNOWN_COMMAND: defineError(2, "error.usage", "error.reason.unknownCommand"),
  COMMAND_UNAVAILABLE: defineError(
    3,
    "error.usage",
    "error.reason.commandUnavailable",
  ),
  INVALID_DURATION: defineError(
    2,
    "error.usage",
    "error.reason.invalidDuration",
  ),
  INVALID_PATH: defineError(3, "error.usage", "error.reason.invalidPath"),
  INVALID_PROJECT_NAME: defineError(
    2,
    "error.usage",
    "error.reason.invalidProjectName",
  ),
  INVALID_RUN_ID: defineError(2, "error.usage", "error.reason.invalidRunId"),
  DEVICE_PROBE_CAPABILITY_REQUIRED: defineError(
    2,
    "error.usage",
    "error.reason.deviceProbeCapabilityRequired",
  ),
  PROJECT_NOT_FOUND: defineError(
    3,
    "error.configuration",
    "error.reason.projectNotFound",
  ),
  CONFIG_EXISTS: defineError(
    3,
    "error.configuration",
    "error.reason.configExists",
  ),
  CONFIG_KEY_NOT_FOUND: defineError(
    3,
    "error.configuration",
    "error.reason.configKeyNotFound",
  ),
  CONFIG_SCOPE_INVALID: defineError(
    2,
    "error.configuration",
    "error.reason.configScopeInvalid",
  ),
  INVALID_CONFIG: defineError(
    3,
    "error.configuration",
    "error.reason.invalidConfig",
  ),
  INVALID_TOML: defineError(
    3,
    "error.configuration",
    "error.reason.invalidToml",
  ),
  UNSUPPORTED_CONFIG_VERSION: defineError(
    3,
    "error.configuration",
    "error.reason.unsupportedConfigVersion",
  ),
  INVALID_ADAPTER_SELECTION: defineError(
    3,
    "error.configuration",
    "error.reason.invalidAdapterSelection",
  ),
  INVALID_APPROVAL_LEVEL: defineError(
    3,
    "error.configuration",
    "error.reason.invalidApprovalLevel",
  ),
  INVALID_ADAPTER_CONFIG: defineError(
    3,
    "error.configuration",
    "error.reason.invalidAdapterConfig",
  ),
  INVALID_DEVICE_CONFIG: defineError(
    3,
    "error.configuration",
    "error.reason.invalidDeviceConfig",
  ),
  INVALID_SYSTEM_CONFIG: defineError(
    3,
    "error.configuration",
    "error.reason.invalidSystemConfig",
  ),
  INIT_TARGET_EXISTS: defineError(
    3,
    "error.configuration",
    "error.reason.initTargetExists",
  ),
  UNKNOWN_ADAPTER: defineError(
    3,
    "error.configuration",
    "error.reason.unknownAdapter",
  ),
  ADAPTER_NOT_FOUND: defineError(
    3,
    "error.configuration",
    "error.reason.adapterNotFound",
  ),
  ADAPTER_CONFIGURATION_DISCOVERY_UNAVAILABLE: defineError(
    3,
    "error.configuration",
    "error.reason.adapterConfigurationDiscoveryUnavailable",
  ),
  ADAPTER_CONFIGURATION_INCOMPLETE: defineError(
    3,
    "error.configuration",
    "error.reason.adapterConfigurationIncomplete",
  ),
  ADAPTER_INSTALLATION_UNAVAILABLE: defineError(
    3,
    "error.configuration",
    "error.reason.adapterInstallationUnavailable",
  ),
  ADAPTER_INSTALLATION_FAILED: defineError(
    5,
    "error.configuration",
    "error.reason.adapterInstallationFailed",
  ),
  DEVICE_NOT_FOUND: defineError(
    3,
    "error.device",
    "error.reason.deviceNotFound",
  ),
  DEVICE_BUSY: defineError(4, "error.device", "error.reason.deviceBusy", true),
  DEVICE_IDENTITY_UNAVAILABLE: defineError(
    3,
    "error.device",
    "error.reason.deviceIdentityUnavailable",
  ),
  DEVICE_QUARANTINED: defineError(
    4,
    "error.device",
    "error.reason.deviceQuarantined",
  ),
  UNSUPPORTED_CAPABILITY: defineError(
    3,
    "error.device",
    "error.reason.unsupportedCapability",
  ),
  SYSTEM_NOT_FOUND: defineError(
    3,
    "error.system",
    "error.reason.systemNotFound",
  ),
  SYSTEM_CAPABILITY_UNAVAILABLE: defineError(
    3,
    "error.system",
    "error.reason.systemCapabilityUnavailable",
  ),
  SYSTEM_MEMBER_NOT_FOUND: defineError(
    3,
    "error.system",
    "error.reason.systemMemberNotFound",
  ),
  SYSTEM_MEMBER_EXISTS: defineError(
    3,
    "error.system",
    "error.reason.systemMemberExists",
  ),
  SYSTEM_MEMBER_REQUIRED: defineError(
    3,
    "error.system",
    "error.reason.systemMemberRequired",
  ),
  SYSTEM_OPERATION_FAILED: defineError(
    5,
    "error.system",
    "error.reason.systemOperationFailed",
  ),
  INVALID_LOCK_ID: defineError(2, "error.lock", "error.reason.invalidLockId"),
  LOCK_NOT_FOUND: defineError(3, "error.lock", "error.reason.lockNotFound"),
  LOCK_RECOVERY_NOT_FOUND: defineError(
    3,
    "error.lock",
    "error.reason.lockRecoveryNotFound",
  ),
  LOCK_CORRUPT: defineError(4, "error.lock", "error.reason.lockCorrupt"),
  LOCK_QUARANTINED: defineError(
    4,
    "error.lock",
    "error.reason.lockQuarantined",
  ),
  LOCK_OWNERSHIP_LOST: defineError(
    4,
    "error.lock",
    "error.reason.lockOwnershipLost",
    true,
  ),
  LOCK_GUARD_BUSY: defineError(
    4,
    "error.lock",
    "error.reason.lockGuardBusy",
    true,
  ),
  QUARANTINE_FAILED: defineError(
    5,
    "error.lock",
    "error.reason.quarantineFailed",
  ),
  INVALID_APPROVAL_ID: defineError(
    2,
    "error.approval",
    "error.reason.invalidApprovalId",
  ),
  APPROVAL_NOT_FOUND: defineError(
    3,
    "error.approval",
    "error.reason.approvalNotFound",
  ),
  APPROVAL_STATE_INVALID: defineError(
    7,
    "error.approval",
    "error.reason.approvalStateInvalid",
  ),
  APPROVAL_EXPIRED: defineError(
    7,
    "error.approval",
    "error.reason.approvalExpired",
  ),
  APPROVAL_ALREADY_CLAIMED: defineError(
    7,
    "error.approval",
    "error.reason.approvalAlreadyClaimed",
    true,
  ),
  APPROVAL_CHALLENGE_FAILED: defineError(
    7,
    "error.approval",
    "error.reason.approvalChallengeFailed",
  ),
  APPROVAL_CHALLENGE_UNAVAILABLE: defineError(
    7,
    "error.approval",
    "error.reason.approvalChallengeUnavailable",
  ),
  APPROVAL_GUARD_BUSY: defineError(
    7,
    "error.approval",
    "error.reason.approvalGuardBusy",
    true,
  ),
  HUMAN_APPROVAL_REQUIRED: defineError(
    7,
    "error.approval",
    "error.reason.humanApprovalRequired",
  ),
  DANGEROUS_CONFIRMATION_REQUIRED: defineError(
    7,
    "error.safety",
    "error.reason.dangerousConfirmationRequired",
  ),
  DANGEROUS_EFFECT_MARKER_MISSING: defineError(
    5,
    "error.safety",
    "error.reason.dangerousEffectMarkerMissing",
  ),
  INVALID_ARTIFACT: defineError(
    5,
    "error.operation",
    "error.reason.invalidArtifact",
  ),
  INVALID_CAPABILITY_INPUT: defineError(
    2,
    "error.operation",
    "error.reason.invalidCapabilityInput",
  ),
  INVALID_CAPABILITY_OUTPUT: defineError(
    5,
    "error.operation",
    "error.reason.invalidCapabilityOutput",
  ),
  OPERATION_TIMEOUT: defineError(
    6,
    "error.operation",
    "error.reason.operationTimeout",
    true,
  ),
  OPERATION_ABORTED: defineError(
    6,
    "error.operation",
    "error.reason.operationAborted",
    true,
  ),
  CLEANUP_FAILED: defineError(
    5,
    "error.operation",
    "error.reason.cleanupFailed",
  ),
  CLEANUP_TIMEOUT: defineError(
    5,
    "error.operation",
    "error.reason.cleanupTimeout",
  ),
  PROCESS_CLEANUP_TIMEOUT: defineError(
    5,
    "error.operation",
    "error.reason.processCleanupTimeout",
  ),
  INTERACTION_CANCELLED: defineError(
    130,
    "error.interaction",
    "error.reason.interactionCancelled",
  ),
  AGENT_INTERACTION_UNSUPPORTED: defineError(
    2,
    "error.interaction",
    "error.reason.agentInteractionUnsupported",
  ),
  INTERACTIVE_TERMINAL_REQUIRED: defineError(
    2,
    "error.interaction",
    "error.reason.interactiveTerminalRequired",
  ),
  INTERACTIVE_MACHINE_OUTPUT_UNSUPPORTED: defineError(
    2,
    "error.interaction",
    "error.reason.interactiveMachineOutputUnsupported",
  ),
  UPGRADE_INSTALLATION_NOT_FOUND: defineError(
    3,
    "error.upgrade",
    "error.reason.upgradeInstallationNotFound",
  ),
  UPGRADE_PACKAGE_MANAGER_NOT_FOUND: defineError(
    3,
    "error.upgrade",
    "error.reason.upgradePackageManagerNotFound",
  ),
  UPGRADE_REGISTRY_UNAVAILABLE: defineError(
    5,
    "error.upgrade",
    "error.reason.upgradeRegistryUnavailable",
    true,
  ),
  UPGRADE_VERSION_NOT_FOUND: defineError(
    2,
    "error.upgrade",
    "error.reason.upgradeVersionNotFound",
  ),
  UPGRADE_FAILED: defineError(5, "error.upgrade", "error.reason.upgradeFailed"),
  DUPLICATE_ADAPTER: defineError(
    8,
    "error.internal",
    "error.reason.duplicateAdapter",
  ),
  INVALID_ADAPTER_DEFINITION: defineError(
    8,
    "error.internal",
    "error.reason.invalidAdapterDefinition",
  ),
  UNSUPPORTED_ADAPTER_API_VERSION: defineError(
    8,
    "error.internal",
    "error.reason.unsupportedAdapterApiVersion",
  ),
  OPERATION_SESSION_STATE_INVALID: defineError(
    8,
    "error.internal",
    "error.reason.operationSessionStateInvalid",
  ),
  FILE_GUARD_BUSY: defineError(
    4,
    "error.internal",
    "error.reason.fileGuardBusy",
    true,
  ),
  INTERNAL_ERROR: defineError(
    8,
    "error.internal",
    "error.reason.internalError",
  ),
} as const;

export type CoreErrorKind = keyof typeof coreErrorCatalog;

export const isCoreErrorKind = (kind: string): kind is CoreErrorKind =>
  Object.hasOwn(coreErrorCatalog, kind);

export const coreErrorDefinition = (kind: string) =>
  isCoreErrorKind(kind) ? coreErrorCatalog[kind] : undefined;
