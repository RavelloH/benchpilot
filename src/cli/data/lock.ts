import type { LockLiveness, LockRecord } from "../../core.js";
import type { CliDataPage } from "./page.js";

export interface LockDetailData {
  readonly schema: "benchpilot.lock-detail";
  readonly version: 1;
  readonly id: string;
  /** Current process/lease assessment, calculated when the page is requested. */
  readonly liveness: LockLiveness;
  /** Technical state persisted in the lock record. */
  readonly state: LockRecord["state"];
  readonly resource: {
    readonly adapter: string;
    readonly kind: string;
    readonly physicalId: string;
  };
  readonly owner: {
    readonly hostname: string;
    readonly pid: number;
    readonly command: string;
    readonly session?: string;
    readonly runId?: string;
  };
  readonly timing: {
    readonly acquiredAt: string;
    readonly heartbeatAt: string;
    readonly expiresAt: string;
  };
}

export type LockSummaryData = Omit<
  LockDetailData,
  "schema" | "version" | "liveness"
>;

export type ListedLockSummaryData = LockSummaryData & {
  /** The state of the persisted record is distinct from its current liveness. */
  readonly liveness: LockLiveness;
};

type ListedLock = LockRecord & { readonly liveness: LockLiveness };
type InspectedLock = LockRecord & { readonly liveness: LockLiveness };

export interface LockCorruptData {
  readonly id: string;
  readonly directory: string;
  readonly entries: readonly string[];
}

export interface LockListData {
  readonly schema: "benchpilot.lock-list";
  readonly version: 1;
  readonly locks: readonly ListedLockSummaryData[];
  readonly corrupt: readonly LockCorruptData[];
}

export interface LockClearStaleData {
  readonly schema: "benchpilot.lock-clear-stale";
  readonly version: 1;
  readonly cleared: readonly string[];
}

export interface LockClearData {
  readonly schema: "benchpilot.lock-clear";
  readonly version: 1;
  readonly lock: LockSummaryData;
}

export const toLockDetailData = (record: InspectedLock): LockDetailData => ({
  schema: "benchpilot.lock-detail",
  version: 1,
  id: record.lockId,
  liveness: record.liveness,
  state: record.state,
  resource: {
    adapter: record.identity.adapter,
    kind: record.identity.kind,
    physicalId: record.identity.physicalId,
  },
  owner: {
    hostname: record.hostname,
    pid: record.pid,
    command: record.command,
    ...(record.session ? { session: record.session } : {}),
    ...(record.runId ? { runId: record.runId } : {}),
  },
  timing: {
    acquiredAt: record.acquiredAt,
    heartbeatAt: record.heartbeatAt,
    expiresAt: record.expiresAt,
  },
});

const toLockSummaryData = (record: LockRecord): LockSummaryData => {
  return {
    id: record.lockId,
    state: record.state,
    resource: {
      adapter: record.identity.adapter,
      kind: record.identity.kind,
      physicalId: record.identity.physicalId,
    },
    owner: {
      hostname: record.hostname,
      pid: record.pid,
      command: record.command,
      ...(record.session ? { session: record.session } : {}),
      ...(record.runId ? { runId: record.runId } : {}),
    },
    timing: {
      acquiredAt: record.acquiredAt,
      heartbeatAt: record.heartbeatAt,
      expiresAt: record.expiresAt,
    },
  };
};

const toListedLockSummaryData = (
  record: ListedLock,
): ListedLockSummaryData => ({
  ...toLockSummaryData(record),
  liveness: record.liveness,
});

export const lockDetailDataPage = (
  record: InspectedLock,
): CliDataPage<LockDetailData> => {
  const data = toLockDetailData(record);
  return { data };
};

export const toLockListData = (input: {
  locks: readonly ListedLock[];
  corrupt: readonly { lockId: string; directory: string; entries: string[] }[];
}): LockListData => ({
  schema: "benchpilot.lock-list",
  version: 1,
  locks: input.locks.map(toListedLockSummaryData),
  corrupt: input.corrupt.map((entry) => ({
    id: entry.lockId,
    directory: entry.directory,
    entries: entry.entries,
  })),
});

export const lockListDataPage = (input: {
  locks: readonly ListedLock[];
  corrupt: readonly { lockId: string; directory: string; entries: string[] }[];
}): CliDataPage<LockListData> => {
  const data = toLockListData(input);
  return {
    data,
    jsonl: [
      ...data.locks.map((lock) => ({
        key: `locks.${lock.id}`,
        value: lock,
      })),
      ...data.corrupt.map((lock) => ({
        key: `corrupt.${lock.id}`,
        value: lock,
      })),
    ],
  };
};

export const lockClearStaleDataPage = (
  cleared: readonly string[],
): CliDataPage<LockClearStaleData> => {
  const data: LockClearStaleData = {
    schema: "benchpilot.lock-clear-stale",
    version: 1,
    cleared,
  };
  return { data };
};

export const lockClearDataPage = (
  record: LockRecord,
): CliDataPage<LockClearData> => {
  const data: LockClearData = {
    schema: "benchpilot.lock-clear",
    version: 1,
    lock: toLockSummaryData(record),
  };
  return { data };
};
