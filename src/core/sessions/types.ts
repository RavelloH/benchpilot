export const MANAGED_SESSION_ID_PATTERN = /^session-[a-zA-Z0-9_-]+$/;

export type ManagedSessionState =
  "creating" | "starting" | "running" | "stopping" | "stopped" | "failed";

export interface ManagedSessionIdentity {
  readonly adapter: string;
  readonly instance: string;
  readonly physicalId: string;
}

/** Public, locale-neutral state. It is safe to use in a command result. */
export interface ManagedSessionRecord {
  readonly schema: "benchpilot.managed-session";
  readonly version: 1;
  readonly id: string;
  readonly state: ManagedSessionState;
  readonly revision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly projectRoot: string;
  readonly capabilityId: string;
  readonly identity: ManagedSessionIdentity;
  readonly ownerPid?: number;
  readonly runId?: string;
  readonly lockId?: string;
  /** Publicly discoverable local endpoint; authorization still needs controlToken. */
  readonly controlEndpoint?: string;
  readonly startedAt?: string;
  readonly endedAt?: string;
  readonly failure?: {
    readonly kind: string;
    readonly message: string;
    readonly quarantinedLock?: boolean;
  };
}

/** Private local control data. Never place this in a Run, artifact or Result. */
export interface ManagedSessionControlRecord {
  readonly schema: "benchpilot.managed-session-control";
  readonly version: 1;
  readonly sessionId: string;
  readonly controlToken: string;
  readonly handshakeToken: string;
  readonly createdAt: string;
}

/** One-time material passed only from the starter to its session host. */
export interface ManagedSessionLaunchPermit {
  readonly sessionId: string;
  readonly controlToken: string;
  readonly handshakeToken: string;
}

export interface CreateManagedSessionInput {
  readonly projectRoot: string;
  readonly capabilityId: string;
  readonly identity: ManagedSessionIdentity;
}

export interface ManagedSessionStartClaim {
  readonly sessionId: string;
  readonly handshakeToken: string;
  readonly expectedRevision: number;
  readonly ownerPid: number;
}

export interface ManagedSessionRunningUpdate {
  readonly sessionId: string;
  readonly controlToken: string;
  readonly expectedRevision: number;
  readonly runId: string;
  readonly lockId: string;
  readonly controlEndpoint: string;
}

export interface ManagedSessionFailure {
  readonly kind: string;
  readonly message: string;
  readonly quarantinedLock?: boolean;
}

export interface ManagedSessionControlRequest {
  readonly schema: "benchpilot.managed-session-control-request";
  readonly version: 1;
  readonly type: "stop";
  readonly sessionId: string;
  readonly controlToken: string;
}

export interface ManagedSessionControlResponse {
  readonly schema: "benchpilot.managed-session-control-response";
  readonly version: 1;
  readonly ok: boolean;
  readonly result?: Record<string, unknown>;
  readonly error?: { readonly kind: string; readonly message: string };
}
