export { BenchPilotError, fail } from "./core/errors/benchpilot-error.js";
export {
  coreErrorCatalog,
  coreErrorDefinition,
  isCoreErrorKind,
  type CoreErrorDefinition,
  type CoreErrorKind,
  type ErrorCategoryKey,
} from "./core/errors/catalog.js";
export {
  arraySchema,
  booleanSchema,
  durationSchema,
  enumSchema,
  numberSchema,
  objectSchema,
  optional,
  SchemaValidationError,
  stringSchema,
} from "./core/adapters/schemas.js";
export type { RuntimeSchema } from "./core/adapters/schemas.js";
export { AdapterRegistry } from "./core/adapters/registry.js";
export type {
  Adapter,
  AdapterConfigurationField,
  AdapterConfigurationDiscovery,
  AdapterConfigurationTool,
  AdapterInstallation,
  AdapterInstallationEstimate,
  AdapterInstallationField,
  AdapterContext,
  AdapterServices,
} from "./core/adapters/types.js";
export {
  lockIdentity,
  type PhysicalResourceIdentity,
} from "./core/locks/lock-identity.js";
export { LockManager } from "./core/locks/lock-manager.js";
export type {
  LockLease,
  LockLiveness,
  LockManagerHooks,
  LockRecord,
  LockQuarantineReason,
} from "./core/locks/types.js";
export {
  acquireFileGuard,
  guardLiveness,
  withFileGuard,
} from "./core/concurrency/file-guard.js";
export type {
  FileGuard,
  FileGuardOptions,
  GuardLiveness,
  GuardRecord,
} from "./core/concurrency/file-guard.js";
export { ApprovalManager } from "./core/approvals/approval-manager.js";
export type {
  ApprovalLease,
  ApprovalLiveness,
  ApprovalRecord,
} from "./core/approvals/types.js";
export type {
  OperationReportAudience,
  OperationReporter,
  OperationReportOptions,
} from "./core/reporting/types.js";
export type {
  BusinessLog,
  BusinessLogEventOptions,
  BusinessLogFactory,
  BusinessLogOpenOptions,
  OperationLogger,
} from "./core/reporting/business-log.js";
export type {
  CleanupError,
  OperationOutcome,
} from "./core/operations/operation-outcome.js";
export type {
  OperationContext,
  OperationServices,
  OperationLifecycleFactories,
  OperationExecutionOptions,
} from "./core/operations/types.js";
export { runCleanupWithGrace } from "./core/operations/cleanup.js";
export { OperationSession } from "./core/operations/operation-session.js";
export type { OperationSessionState } from "./core/operations/operation-session.js";
export {
  abortPromise,
  abortReasonToError,
  type OperationAbortReason,
} from "./core/operations/abort.js";
export { PathService } from "./core/paths/path-service.js";
export { ManagedSessionManager } from "./core/sessions/session-manager.js";
export { ManagedSessionStore } from "./core/sessions/session-store.js";
export { ManagedSessionHost } from "./core/sessions/session-host.js";
export type {
  ManagedSessionHostDependencies,
  ManagedSessionHostLaunch,
  ManagedSessionTransport,
} from "./core/sessions/session-host.js";
export { ManagedSessionLogSpool } from "./core/sessions/session-log-spool.js";
export type { ManagedSessionLogRecord } from "./core/sessions/session-log-spool.js";
export {
  managedSessionRecordsPath,
  readManagedSessionLog,
} from "./core/sessions/session-log-reader.js";
export {
  ManagedSessionReconciler,
  managedSessionOwnerLiveness,
} from "./core/sessions/session-reconciler.js";
export type { ManagedSessionOwnerLiveness } from "./core/sessions/session-reconciler.js";
export type {
  ManagedSessionLogQuery,
  ManagedSessionLogReadResult,
} from "./core/sessions/session-log-reader.js";
export {
  ManagedSessionControlServer,
  managedSessionControlEndpoint,
  requestManagedSessionControl,
} from "./core/sessions/session-control.js";
export type {
  CreateManagedSessionInput,
  ManagedSessionControlRecord,
  ManagedSessionControlRequest,
  ManagedSessionControlResponse,
  ManagedSessionAcquireWriterControlRequest,
  ManagedSessionReleaseWriterControlRequest,
  ManagedSessionRenewWriterControlRequest,
  ManagedSessionStopControlRequest,
  ManagedSessionWriteControlRequest,
  ManagedSessionFailure,
  ManagedSessionIdentity,
  ManagedSessionLaunchPermit,
  ManagedSessionRecord,
  ManagedSessionRunningUpdate,
  ManagedSessionStarter,
  ManagedSessionStartRequest,
  ManagedSessionStartClaim,
  ManagedSessionState,
} from "./core/sessions/types.js";
export { MANAGED_SESSION_ID_PATTERN } from "./core/sessions/types.js";
export { atomicJson, readJson } from "./core/utilities/atomic-json.js";
export { sha, stable } from "./core/utilities/stable-json.js";
export {
  isSupportedNodeVersion,
  parseNodeVersion,
  type NodeVersion,
} from "./core/utilities/node-version.js";
export { resolveInside } from "./core/utilities/resolve-inside.js";
export {
  RunManager,
  RUN_ID_PATTERN,
  type ArtifactRecord,
  type Run,
} from "./core/runs/run-manager.js";
export { ArtifactRegistry } from "./core/artifacts/artifact-registry.js";
export type {
  ArtifactRegistration,
  ArtifactRecord as RegisteredArtifactRecord,
} from "./core/artifacts/types.js";
export type {
  Json,
  ApprovalLevel,
  Origin,
  ResolvedConfig,
  Scope,
} from "./core/config/config.js";
export {
  assertSafeKeyPath,
  approvalLevel,
  deleteKey,
  duration,
  enabledAdapterIds,
  getKey,
  merge,
  redactResolvedConfig,
  requiresApproval,
  setKey,
  validateConfig,
} from "./core/config/config.js";

export type {
  Capability,
  CapabilityDescriptor,
  DeviceRuntime,
  ManagedSessionCapabilityKind,
  ManagedSessionPlan,
  ManagedSessionProtocol,
  ManagedSessionProtocolMethod,
  OptionDefinition,
  Safety,
} from "./core/capabilities/types.js";
export { describeCapability } from "./core/capabilities/descriptor.js";
export { OperationRunner } from "./core/operations/operation-runner.js";
export type { ProcessState } from "./core/process/process-runner.js";
