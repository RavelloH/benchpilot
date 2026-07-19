import type { ApprovalRecord, Json } from "../../core.js";
import { t } from "../../i18n/index.js";
import type { CliScreenNode } from "../presentation/page.js";
import { terminalTheme, type TerminalTheme } from "../presentation/theme.js";
import type { CliDataPage, DataScreenContext } from "./page.js";

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

const displayWidth = (value: string) =>
  [...value].reduce(
    (width, character) => width + (character.codePointAt(0)! > 0xff ? 2 : 1),
    0,
  );

const padLabel = (value: string, width = 12) =>
  `${value}${" ".repeat(Math.max(1, width - displayWidth(value)))}`;

const row = (
  label: string,
  value: string,
  theme: TerminalTheme,
  format: (value: string) => string = theme.argument,
): CliScreenNode => ({
  text: `${theme.muted(padLabel(label))}${format(value)}`,
});

const section = (
  title: string,
  children: readonly CliScreenNode[],
  theme: TerminalTheme,
): CliScreenNode => ({
  text: theme.heading(title),
  children,
});

const statusLabel = (status: ApprovalStatus, context: DataScreenContext) => {
  if (status === "pending") return t(context.locale, "approval.status.pending");
  if (status === "approved")
    return t(context.locale, "approval.status.approved");
  if (status === "rejected")
    return t(context.locale, "approval.status.rejected");
  if (status === "claimed") return t(context.locale, "approval.status.claimed");
  return t(context.locale, "approval.status.consumed");
};

const statusText = (status: ApprovalStatus, context: DataScreenContext) => {
  const theme = terminalTheme(context.color);
  const label = statusLabel(status, context);
  if (status === "approved") return theme.success(label);
  if (status === "pending" || status === "claimed") return theme.warning(label);
  if (status === "rejected") return theme.error(label);
  return theme.debug(label);
};

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

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

interface ApprovalScreenPresentation {
  readonly projectId?: string;
  readonly projectName?: string;
}

const commandPresentation = (command: string, context: DataScreenContext) => {
  const parts = command.split(".");
  const capability = parts.at(-1) || command;
  if (parts[0] === "device")
    return t(context.locale, "approval.command.device", { capability });
  if (parts[0] === "system")
    return t(context.locale, "approval.command.system", { capability });
  return t(context.locale, "approval.command.other", { command });
};

const capabilityPresentation = (
  capability: string,
  summary: string | undefined,
  context: DataScreenContext,
) => {
  const standard: Record<string, Parameters<typeof t>[1]> = {
    info: "approval.capability.info",
    status: "approval.capability.status",
    build: "approval.capability.build",
    flash: "approval.capability.flash",
    deploy: "approval.capability.deploy",
    reset: "approval.capability.reset",
    capture: "approval.capability.capture",
    fullclean: "approval.capability.fullclean",
    erase: "approval.capability.erase",
  };
  const key = standard[capability];
  if (key) return t(context.locale, key);
  return summary || capability;
};

const bindingPresentation = (
  binding: Json,
  context: DataScreenContext,
  presentation: ApprovalScreenPresentation,
): {
  readonly rows: readonly CliScreenNode[];
  readonly device?: CliScreenNode;
} => {
  const theme = terminalTheme(context.color);
  const value = asRecord(binding);
  const device = asRecord(value.device);
  const storedPresentation = asRecord(value.presentation);
  const commandPresentationData = asRecord(storedPresentation.command);
  const projectPresentationData = asRecord(storedPresentation.project);
  const input = value.input;
  const valueText = (key: string) =>
    typeof value[key] === "string" ? value[key] : undefined;
  const rows: readonly CliScreenNode[] = [
    ...(valueText("command")
      ? [
          row(
            t(context.locale, "approval.detail.command"),
            typeof commandPresentationData.capability === "string"
              ? capabilityPresentation(
                  commandPresentationData.capability,
                  typeof commandPresentationData.summary === "string"
                    ? commandPresentationData.summary
                    : undefined,
                  context,
                )
              : commandPresentation(valueText("command")!, context),
            theme,
            theme.command,
          ),
        ]
      : []),
    ...(valueText("project")
      ? [
          row(
            t(context.locale, "approval.detail.project"),
            typeof projectPresentationData.name === "string"
              ? projectPresentationData.name
              : valueText("project") === presentation.projectId &&
                  presentation.projectName
                ? presentation.projectName
                : valueText("project")!,
            theme,
          ),
        ]
      : []),
    ...(input === undefined
      ? []
      : [
          row(
            t(context.locale, "approval.detail.input"),
            JSON.stringify(input),
            theme,
            theme.debug,
          ),
        ]),
  ];
  const deviceSection = Object.keys(device).length
    ? section(
        t(context.locale, "approval.detail.device"),
        [
          ...(typeof device.adapter === "string"
            ? [
                row(
                  t(context.locale, "approval.detail.adapter"),
                  device.adapter,
                  theme,
                ),
              ]
            : []),
          ...(typeof device.instance === "string"
            ? [
                row(
                  t(context.locale, "approval.detail.instance"),
                  device.instance,
                  theme,
                ),
              ]
            : []),
          ...(typeof device.physicalId === "string"
            ? [
                row(
                  t(context.locale, "approval.detail.physicalId"),
                  device.physicalId,
                  theme,
                ),
              ]
            : []),
        ],
        theme,
      )
    : undefined;
  return { rows, ...(deviceSection ? { device: deviceSection } : {}) };
};

const approvalDetailScreen = (
  data: ApprovalDetailData,
  context: DataScreenContext,
  presentation: ApprovalScreenPresentation,
): readonly CliScreenNode[] => {
  const theme = terminalTheme(context.color);
  const binding = bindingPresentation(data.binding, context, presentation);
  return [
    section(
      t(context.locale, "approval.detail.title"),
      [
        row(
          t(context.locale, "approval.detail.id"),
          data.id,
          theme,
          theme.command,
        ),
        row(
          t(context.locale, "approval.detail.status"),
          data.status,
          theme,
          () => statusText(data.status, context),
        ),
      ],
      theme,
    ),
    section(t(context.locale, "approval.detail.binding"), binding.rows, theme),
    ...(binding.device ? [binding.device] : []),
    section(
      t(context.locale, "approval.detail.timing"),
      [
        row(
          t(context.locale, "approval.detail.createdAt"),
          data.timing.createdAt,
          theme,
          theme.debug,
        ),
        row(
          t(context.locale, "approval.detail.expiresAt"),
          data.timing.expiresAt,
          theme,
          theme.debug,
        ),
        ...(data.timing.changedAt
          ? [
              row(
                t(context.locale, "approval.detail.changedAt"),
                data.timing.changedAt,
                theme,
                theme.debug,
              ),
            ]
          : []),
        ...(data.timing.releasedAt
          ? [
              row(
                t(context.locale, "approval.detail.releasedAt"),
                data.timing.releasedAt,
                theme,
                theme.debug,
              ),
            ]
          : []),
        ...(data.timing.consumedAt
          ? [
              row(
                t(context.locale, "approval.detail.consumedAt"),
                data.timing.consumedAt,
                theme,
                theme.debug,
              ),
            ]
          : []),
      ],
      theme,
    ),
    ...(data.claim
      ? [
          section(
            t(context.locale, "approval.detail.claim"),
            [
              ...(data.claim.by
                ? [
                    row(
                      t(context.locale, "approval.detail.claimedBy"),
                      data.claim.by,
                      theme,
                    ),
                  ]
                : []),
              ...(data.claim.claimedAt
                ? [
                    row(
                      t(context.locale, "approval.detail.claimedAt"),
                      data.claim.claimedAt,
                      theme,
                      theme.debug,
                    ),
                  ]
                : []),
              ...(data.claim.heartbeatAt
                ? [
                    row(
                      t(context.locale, "approval.detail.heartbeatAt"),
                      data.claim.heartbeatAt,
                      theme,
                      theme.debug,
                    ),
                  ]
                : []),
              ...(data.claim.expiresAt
                ? [
                    row(
                      t(context.locale, "approval.detail.claimExpiresAt"),
                      data.claim.expiresAt,
                      theme,
                      theme.debug,
                    ),
                  ]
                : []),
            ],
            theme,
          ),
        ]
      : []),
  ];
};

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
    screen: (context) => approvalDetailScreen(data, context, presentation),
  };
};

const approvalListScreen = (
  data: ApprovalListData,
  context: DataScreenContext,
): readonly CliScreenNode[] => {
  const theme = terminalTheme(context.color);
  const rows: readonly CliScreenNode[] = data.approvals.length
    ? [
        {
          text: `${theme.muted(padLabel(t(context.locale, "approval.list.id"), 28))}${theme.muted(padLabel(t(context.locale, "approval.list.status"), 10))}${theme.muted(t(context.locale, "approval.list.expiresAt"))}`,
        },
        ...data.approvals.map((approval) => {
          const label = statusLabel(approval.status, context);
          return {
            text: `${theme.command(padLabel(approval.id, 28))}${statusText(approval.status, context)}${" ".repeat(Math.max(1, 10 - displayWidth(label)))}${theme.debug(approval.timing.expiresAt)}`,
          };
        }),
      ]
    : [{ text: theme.muted(t(context.locale, "approval.list.none")) }];
  return [section(t(context.locale, "approval.list.title"), rows, theme)];
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
    screen: (context) => approvalListScreen(data, context),
    jsonl: data.approvals.map((approval) => ({
      key: `approvals.${approval.id}`,
      value: approval,
    })),
  };
};

const approvalChangeScreen = (
  data: ApprovalChangeData,
  context: DataScreenContext,
): readonly CliScreenNode[] => {
  const theme = terminalTheme(context.color);
  const title =
    data.approval.status === "approved"
      ? t(context.locale, "approval.change.approved")
      : t(context.locale, "approval.change.rejected");
  return [
    section(
      title,
      [
        row(
          t(context.locale, "approval.detail.id"),
          data.approval.id,
          theme,
          theme.command,
        ),
        row(
          t(context.locale, "approval.detail.status"),
          data.approval.status,
          theme,
          () => statusText(data.approval.status, context),
        ),
      ],
      theme,
    ),
  ];
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
  return { data, screen: (context) => approvalChangeScreen(data, context) };
};
