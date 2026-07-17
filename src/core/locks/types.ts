import type { BenchPilotError } from "../errors/benchpilot-error.js";
import type { PhysicalResourceIdentity } from "./lock-identity.js";

export interface LockRecord {
  schema: "benchpilot.lock";
  version: 2;
  state: "active" | "quarantined" | "quarantine-failed";
  quarantineReason?: LockQuarantineReason;
  lockId: string;
  identity: PhysicalResourceIdentity;
  ownerToken: string;
  pid: number;
  hostname: string;
  session?: string;
  command: string;
  runId?: string;
  acquiredAt: string;
  heartbeatAt: string;
  expiresAt: string;
}

export interface LockQuarantineReason {
  kind: string;
  message: string;
  cleanupErrors: Array<{
    name: string;
    critical: boolean;
    message: string;
  }>;
  runId?: string;
  quarantinedAt: string;
}

export type LockLiveness = "active" | "stale" | "unknown";

export interface LockLease {
  readonly lock: LockRecord;
  readonly lost: Promise<never>;
  stop(): Promise<void>;
}

export interface LockManagerHooks {
  heartbeatRead?(record: LockRecord): Promise<void> | void;
  releaseRead?(record: LockRecord): Promise<void> | void;
  clearRead?(record: LockRecord): Promise<void> | void;
  guardError?(error: BenchPilotError): void;
}
