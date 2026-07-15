import type { BenchPilotError } from "../errors/benchpilot-error.js";

export type Json = Record<string, unknown>;

export type ApprovalStatus =
  "pending" | "approved" | "rejected" | "claimed" | "consumed";

export interface ApprovalRecord {
  schema: "benchpilot.approval";
  version: 1;
  id: string;
  digest: string;
  binding: Json;
  createdAt: string;
  expiresAt: string;
  status: ApprovalStatus;
  changedAt?: string;
  claimedBy?: string;
  claimedAt?: string;
  claimHeartbeatAt?: string;
  claimExpiresAt?: string;
  claimToken?: string;
  releasedAt?: string;
  consumedAt?: string;
}

export type ApprovalLiveness = "active" | "stale" | "unknown";

export interface ApprovalLease {
  readonly approval: ApprovalRecord;
  readonly lost: Promise<BenchPilotError>;
  stop(): Promise<void>;
}
