import type { LockLiveness, LockRecord } from "../../core.js";
import { t } from "../../i18n/index.js";
import type { CliScreenNode } from "../presentation/page.js";
import { terminalTheme, type TerminalTheme } from "../presentation/theme.js";
import type { CliDataPage, DataScreenContext } from "./page.js";

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

const displayWidth = (value: string) =>
  [...value].reduce(
    (width, character) => width + (character.codePointAt(0)! > 0xff ? 2 : 1),
    0,
  );

const padLabel = (value: string, width = 12) =>
  `${value}${" ".repeat(Math.max(1, width - displayWidth(value)))}`;

const stateText = (state: LockDetailData["state"], theme: TerminalTheme) =>
  state === "active"
    ? theme.success(state)
    : state === "quarantined"
      ? theme.warning(state)
      : theme.error(state);

const row = (
  label: string,
  value: string | number,
  theme: TerminalTheme,
  format: (value: string) => string = theme.argument,
): CliScreenNode => ({
  text: `${theme.muted(padLabel(label))}${format(String(value))}`,
});

const section = (
  title: string,
  children: readonly CliScreenNode[],
  theme: TerminalTheme,
  lineBreak = false,
): CliScreenNode => ({
  lineBreak,
  text: theme.heading(title),
  children,
});

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

export function lockDetailScreen(
  data: LockDetailData,
  context: DataScreenContext,
): readonly CliScreenNode[] {
  const theme = terminalTheme(context.color);
  const livenessText = (liveness: LockLiveness) => {
    const label =
      liveness === "active"
        ? t(context.locale, "lock.list.liveness.active")
        : liveness === "stale"
          ? t(context.locale, "lock.list.liveness.stale")
          : t(context.locale, "lock.list.liveness.unknown");
    if (liveness === "active") return theme.success(label);
    if (liveness === "stale") return theme.warning(label);
    return theme.debug(label);
  };
  return [
    section(
      t(context.locale, "lock.detail.title"),
      [
        row(t(context.locale, "lock.detail.id"), data.id, theme, theme.command),
        row(
          t(context.locale, "lock.detail.liveness"),
          data.liveness,
          theme,
          (value) => livenessText(value as LockLiveness),
        ),
        row(
          t(context.locale, "lock.detail.recordState"),
          data.state,
          theme,
          (value) => stateText(value as LockDetailData["state"], theme),
        ),
      ],
      theme,
    ),
    section(
      t(context.locale, "lock.detail.resource"),
      [
        row(
          t(context.locale, "lock.detail.adapter"),
          data.resource.adapter,
          theme,
        ),
        row(t(context.locale, "lock.detail.kind"), data.resource.kind, theme),
        row(
          t(context.locale, "lock.detail.physicalId"),
          data.resource.physicalId,
          theme,
        ),
      ],
      theme,
    ),
    section(
      t(context.locale, "lock.detail.owner"),
      [
        row(t(context.locale, "lock.detail.host"), data.owner.hostname, theme),
        row(t(context.locale, "lock.detail.process"), data.owner.pid, theme),
        row(
          t(context.locale, "lock.detail.command"),
          data.owner.command,
          theme,
          theme.command,
        ),
        ...(data.owner.session
          ? [
              row(
                t(context.locale, "lock.detail.session"),
                data.owner.session,
                theme,
              ),
            ]
          : []),
        ...(data.owner.runId
          ? [row(t(context.locale, "lock.detail.run"), data.owner.runId, theme)]
          : []),
      ],
      theme,
    ),
    section(
      t(context.locale, "lock.detail.timing"),
      [
        row(
          t(context.locale, "lock.detail.acquiredAt"),
          data.timing.acquiredAt,
          theme,
          theme.debug,
        ),
        row(
          t(context.locale, "lock.detail.heartbeatAt"),
          data.timing.heartbeatAt,
          theme,
          theme.debug,
        ),
        row(
          t(context.locale, "lock.detail.expiresAt"),
          data.timing.expiresAt,
          theme,
          theme.debug,
        ),
      ],
      theme,
    ),
  ];
}

export const lockDetailDataPage = (
  record: InspectedLock,
): CliDataPage<LockDetailData> => {
  const data = toLockDetailData(record);
  return { data, screen: (context) => lockDetailScreen(data, context) };
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

function lockListScreen(
  data: LockListData,
  context: DataScreenContext,
): readonly CliScreenNode[] {
  const theme = terminalTheme(context.color);
  const livenessText = (liveness: LockLiveness) => {
    const label =
      liveness === "active"
        ? t(context.locale, "lock.list.liveness.active")
        : liveness === "stale"
          ? t(context.locale, "lock.list.liveness.stale")
          : t(context.locale, "lock.list.liveness.unknown");
    const padding = " ".repeat(Math.max(1, 10 - displayWidth(label)));
    if (liveness === "active") return `${theme.success(label)}${padding}`;
    if (liveness === "stale") return `${theme.warning(label)}${padding}`;
    return `${theme.debug(label)}${padding}`;
  };
  const lockRows: readonly CliScreenNode[] = data.locks.length
    ? [
        {
          text: `${theme.muted(padLabel(t(context.locale, "lock.list.id"), 34))}${theme.muted(padLabel(t(context.locale, "lock.list.status"), 10))}${theme.muted(t(context.locale, "lock.list.resource"))}`,
        },
        ...data.locks.map((lock) => ({
          text: `${theme.command(padLabel(lock.id, 34))}${livenessText(lock.liveness)}${theme.argument(`${lock.resource.adapter} / ${lock.resource.kind}`)}`,
        })),
      ]
    : [{ text: theme.muted(t(context.locale, "lock.list.none")) }];
  return [
    section(t(context.locale, "lock.list.title"), lockRows, theme),
    ...(data.corrupt.length
      ? [
          section(
            t(context.locale, "lock.list.corrupt"),
            [
              {
                text: `${theme.muted(padLabel(t(context.locale, "lock.list.id"), 34))}${theme.muted(t(context.locale, "lock.list.contents"))}`,
              },
              ...data.corrupt.map((lock) => ({
                text: `${theme.error(padLabel(lock.id, 34))}${theme.muted(lock.entries.join(", "))}`,
              })),
            ],
            theme,
          ),
        ]
      : []),
  ];
}

export const lockListDataPage = (input: {
  locks: readonly ListedLock[];
  corrupt: readonly { lockId: string; directory: string; entries: string[] }[];
}): CliDataPage<LockListData> => {
  const data = toLockListData(input);
  return {
    data,
    screen: (context) => lockListScreen(data, context),
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

function lockClearStaleScreen(
  data: LockClearStaleData,
  context: DataScreenContext,
): readonly CliScreenNode[] {
  const theme = terminalTheme(context.color);
  return [
    section(
      t(context.locale, "lock.clearStale.heading"),
      data.cleared.length
        ? [
            ...data.cleared.slice(0, 5).map((id) => ({
              text: theme.command(id),
            })),
            ...(data.cleared.length > 5
              ? [
                  {
                    text: theme.warning(
                      t(context.locale, "lock.clearStale.remaining", {
                        count: data.cleared.length,
                      }),
                    ),
                  },
                ]
              : []),
          ]
        : [{ text: theme.muted(t(context.locale, "lock.clearStale.none")) }],
      theme,
    ),
  ];
}

export const lockClearStaleDataPage = (
  cleared: readonly string[],
): CliDataPage<LockClearStaleData> => {
  const data: LockClearStaleData = {
    schema: "benchpilot.lock-clear-stale",
    version: 1,
    cleared,
  };
  return { data, screen: (context) => lockClearStaleScreen(data, context) };
};

function lockClearScreen(
  data: LockClearData,
  context: DataScreenContext,
): readonly CliScreenNode[] {
  const theme = terminalTheme(context.color);
  return [
    section(
      t(context.locale, "lock.clear.title"),
      [
        row(
          t(context.locale, "lock.detail.id"),
          data.lock.id,
          theme,
          theme.command,
        ),
        row(
          t(context.locale, "lock.detail.physicalId"),
          data.lock.resource.physicalId,
          theme,
        ),
      ],
      theme,
    ),
  ];
}

export const lockClearDataPage = (
  record: LockRecord,
): CliDataPage<LockClearData> => {
  const data: LockClearData = {
    schema: "benchpilot.lock-clear",
    version: 1,
    lock: toLockSummaryData(record),
  };
  return { data, screen: (context) => lockClearScreen(data, context) };
};
