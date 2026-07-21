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
  readonly ownerHostname?: string;
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

export interface ManagedSessionStartRequest {
  readonly projectRoot: string;
  readonly command: string;
  readonly capabilityId: string;
  readonly identity: ManagedSessionIdentity;
  readonly lockId: string;
  readonly plan: import("../capabilities/types.js").ManagedSessionPlan;
  readonly overrides: {
    readonly baud?: number;
    readonly encoding?: "utf8" | "binary";
    readonly lineFraming?: "line" | "raw";
    readonly dtr?: "preserve" | "off" | "on";
    readonly rts?: "preserve" | "off" | "on";
  };
  readonly runContext: Record<string, unknown>;
}

/** Infrastructure starts the child process; Core owns the request contract. */
export interface ManagedSessionStarter {
  start(input: ManagedSessionStartRequest): Promise<ManagedSessionRecord>;
  find(input: {
    identity: ManagedSessionIdentity;
    sessionId?: string;
    activeOnly?: boolean;
  }): Promise<ManagedSessionRecord | undefined>;
  stop(input: {
    identity: ManagedSessionIdentity;
    sessionId?: string;
  }): Promise<ManagedSessionRecord | undefined>;
  logs(input: {
    identity: ManagedSessionIdentity;
    sessionId?: string;
    tail?: number;
    cursor?: string;
  }): Promise<import("./session-log-reader.js").ManagedSessionLogReadResult>;
  write(input: { sessionId: string; data: Uint8Array }): Promise<number>;
}

export interface ManagedSessionStopControlRequest {
  readonly schema: "benchpilot.managed-session-control-request";
  readonly version: 1;
  readonly type: "stop";
  readonly sessionId: string;
  readonly controlToken: string;
}

export interface ManagedSessionWriteControlRequest {
  readonly schema: "benchpilot.managed-session-control-request";
  readonly version: 1;
  readonly type: "write";
  readonly sessionId: string;
  readonly controlToken: string;
  readonly leaseId: string;
  readonly dataBase64: string;
}

export interface ManagedSessionAcquireWriterControlRequest {
  readonly schema: "benchpilot.managed-session-control-request";
  readonly version: 1;
  readonly type: "acquire-writer";
  readonly sessionId: string;
  readonly controlToken: string;
}

export interface ManagedSessionRenewWriterControlRequest {
  readonly schema: "benchpilot.managed-session-control-request";
  readonly version: 1;
  readonly type: "renew-writer";
  readonly sessionId: string;
  readonly controlToken: string;
  readonly leaseId: string;
}

export interface ManagedSessionReleaseWriterControlRequest {
  readonly schema: "benchpilot.managed-session-control-request";
  readonly version: 1;
  readonly type: "release-writer";
  readonly sessionId: string;
  readonly controlToken: string;
  readonly leaseId: string;
}

export type ManagedSessionControlRequest =
  | ManagedSessionStopControlRequest
  | ManagedSessionWriteControlRequest
  | ManagedSessionAcquireWriterControlRequest
  | ManagedSessionRenewWriterControlRequest
  | ManagedSessionReleaseWriterControlRequest;

export interface ManagedSessionControlResponse {
  readonly schema: "benchpilot.managed-session-control-response";
  readonly version: 1;
  readonly ok: boolean;
  readonly result?: Record<string, unknown>;
  readonly error?: { readonly kind: string; readonly message: string };
}
