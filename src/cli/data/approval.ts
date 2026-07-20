import type { ApprovalRecord, Json } from "../../core.js";
import type { CliDataPage } from "./page.js";

type ApprovalStatus = ApprovalRecord["status"];

export interface ApprovalData {
  readonly id: string;
  readonly status: ApprovalStatus;
  readonly digest: string;
  readonly binding: Json;
  readonly timing: {
    readonly createdAt: string;
    readonly expiresAt: string;
    readonly changedAt?: string;
    readonly releasedAt?: string;
    readonly consumedAt?: string;
  };
  readonly claim?: {
    readonly by?: string;
    readonly claimedAt?: string;
    readonly heartbeatAt?: string;
    readonly expiresAt?: string;
  };
}

export interface ApprovalListData {
  readonly schema: "benchpilot.approval-list";
  readonly version: 1;
  readonly approvals: readonly ApprovalData[];
}

export interface ApprovalDetailData extends ApprovalData {
  readonly schema: "benchpilot.approval-detail";
  readonly version: 1;
}

export interface ApprovalChangeData {
  readonly schema: "benchpilot.approval-change";
  readonly version: 1;
  readonly approval: Pick<ApprovalData, "id" | "status">;
}

const toApprovalData = (record: ApprovalRecord): ApprovalData => ({
  id: record.id,
  status: record.status,
  digest: record.digest,
  binding: record.binding,
  timing: {
    createdAt: record.createdAt,
    expiresAt: record.expiresAt,
    ...(record.changedAt ? { changedAt: record.changedAt } : {}),
    ...(record.releasedAt ? { releasedAt: record.releasedAt } : {}),
    ...(record.consumedAt ? { consumedAt: record.consumedAt } : {}),
  },
  ...(record.status === "claimed"
    ? {
        claim: {
          ...(record.claimedBy ? { by: record.claimedBy } : {}),
          ...(record.claimedAt ? { claimedAt: record.claimedAt } : {}),
          ...(record.claimHeartbeatAt
            ? { heartbeatAt: record.claimHeartbeatAt }
            : {}),
          ...(record.claimExpiresAt
            ? { expiresAt: record.claimExpiresAt }
            : {}),
        },
      }
    : {}),
});

export interface ApprovalScreenPresentation {
  readonly projectId?: string;
  readonly projectName?: string;
}

export const approvalDetailDataPage = (
  record: ApprovalRecord,
  presentation: ApprovalScreenPresentation = {},
): CliDataPage<ApprovalDetailData> => {
  const data: ApprovalDetailData = {
    schema: "benchpilot.approval-detail",
    version: 1,
    ...toApprovalData(record),
  };
  return {
    data,
    ...(Object.keys(presentation).length ? { presentation } : {}),
  };
};

export const approvalListDataPage = (
  records: readonly ApprovalRecord[],
): CliDataPage<ApprovalListData> => {
  const data: ApprovalListData = {
    schema: "benchpilot.approval-list",
    version: 1,
    approvals: records.map(toApprovalData),
  };
  return {
    data,
    jsonl: data.approvals.map((approval) => ({
      key: `approvals.${approval.id}`,
      value: approval,
    })),
  };
};

export const approvalChangeDataPage = (input: {
  id: string;
  status: "approved" | "rejected";
}): CliDataPage<ApprovalChangeData> => {
  const data: ApprovalChangeData = {
    schema: "benchpilot.approval-change",
    version: 1,
    approval: input,
  };
  return { data };
};
