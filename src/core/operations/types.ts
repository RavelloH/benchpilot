import type { DeviceRuntime } from "../capabilities/types.js";
import type { Json, ResolvedConfig } from "../config/config.js";
import type { AdapterRegistry } from "../adapters/registry.js";
import type {
  ArtifactRegistration,
  ArtifactRecord,
} from "../artifacts/types.js";
import type { PathService } from "../paths/path-service.js";
import type { Run } from "../runs/run-manager.js";
import type { RunManager } from "../runs/run-manager.js";
import type { LockManager } from "../locks/lock-manager.js";
import type { ApprovalManager } from "../approvals/approval-manager.js";
import type { OperationReporter } from "../reporting/types.js";
import type {
  BusinessLogFactory,
  OperationLogger,
} from "../reporting/business-log.js";
import type { OperationOutcome } from "./operation-outcome.js";
import type {
  ManagedSessionIdentity,
  ManagedSessionStarter,
} from "../sessions/types.js";
import type { ManagedSessionPlan } from "../capabilities/types.js";

export interface OperationContext {
  signal: AbortSignal;
  logger: OperationLogger;
  run?: Run;
  stateRoot: string;
  project?: { root: string; config: string };
  config: Json;
  device: DeviceRuntime;
  registerCleanup(
    name: string,
    handler: () => Promise<void> | void,
    options?: {
      critical?: boolean;
      holdsPhysicalResource?: boolean;
      timeoutMs?: number;
    },
  ): void;
  readonly dangerousEffect: {
    readonly started: boolean;
    readonly startedAt?: string;
    readonly details?: Json;
  };
  markDangerousEffectStarted(details?: Json): void;
  emitEvent(type: string, data?: Json): void;
  registerArtifact(record: ArtifactRegistration): Promise<ArtifactRecord>;
}

export interface OperationServices {
  paths: PathService;
  registry: AdapterRegistry;
  config: ResolvedConfig;
  project: { root: string; config: string } | undefined;
  defaults?: {
    timeout?: unknown;
    dryRun?: boolean;
    session?: string;
    benchpilotVersion?: string;
  };
  lockHeartbeatIntervalMs?: number;
  lockLeaseMs?: number;
  reporter?: OperationReporter;
  businessLogs: BusinessLogFactory;
  managedSessions?: ManagedSessionStarter;
  lifecycle?: OperationLifecycleFactories;
}

/** Core-owned factories for persisted operation lifecycle state. */
export interface OperationLifecycleFactories {
  locks: LockManager;
  approvals(projectRoot: string): ApprovalManager;
  runs(projectRoot: string): RunManager;
}

export interface OperationExecutionOptions {
  eventScope?: "root" | "child";
  eventContext?: Json;
  /** The CLI completed an interactive approval flow before execution. */
  executionMode?: "interactive";
  /**
   * Terminal adapters provide this only for a declared TTY-only managed-session
   * capability. The Core still owns capability validation and safety policy.
   */
  attachManagedSessionConsole?(input: {
    identity: ManagedSessionIdentity;
    plan: ManagedSessionPlan;
    sessionId?: string;
  }): Promise<void>;
  /** Receives locale-neutral lifecycle facts after cleanup and Run finalization. */
  onOutcome?(outcome: OperationOutcome): void;
}
