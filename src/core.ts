export { BenchPilotError, fail } from "./core/errors/benchpilot-error.js";
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
export { EventWriter } from "./core/events/event-writer.js";
export type {
  BenchPilotEvent,
  BenchPilotEventWriter,
} from "./core/events/types.js";
export type {
  CleanupError,
  OperationOutcome,
} from "./core/operations/operation-outcome.js";
export type {
  OperationContext,
  OperationServices,
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
  Origin,
  ResolvedConfig,
  Scope,
} from "./core/config/config.js";
export {
  assertSafeKeyPath,
  deleteKey,
  duration,
  getKey,
  loadConfig,
  merge,
  projectStorageKey,
  redactResolvedConfig,
  setKey,
  validateConfig,
} from "./core/config/config.js";

export type {
  Capability,
  CapabilityDescriptor,
  DeviceRuntime,
  OptionDefinition,
  Safety,
} from "./core/capabilities/types.js";
export { describeCapability } from "./core/capabilities/descriptor.js";
export { OperationRunner } from "./core/operations/operation-runner.js";
export type { ProcessState } from "./core/process/process-runner.js";
