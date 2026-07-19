import type { Json } from "../../core.js";
import { t } from "../../i18n/index.js";
import type { CliScreenNode } from "../presentation/page.js";
import { terminalTheme, type TerminalTheme } from "../presentation/theme.js";
import type { CliDataPage, DataScreenContext } from "./page.js";

type JsonRecord = Record<string, unknown>;

export interface RunSummaryData {
  readonly id: string;
  readonly status?: string;
  readonly command?: string;
  readonly timing: {
    readonly startedAt?: string;
    readonly endedAt?: string;
    readonly durationMs?: number;
  };
}

export interface RunListData {
  readonly schema: "benchpilot.run-list";
  readonly version: 1;
  readonly runs: readonly RunSummaryData[];
}

export interface RunDetailData {
  readonly schema: "benchpilot.run-detail";
  readonly version: 1;
  readonly run: RunSummaryData & {
    readonly environment: {
      readonly hostname?: string;
      readonly pid?: number;
      readonly platform?: string;
    };
  };
  readonly result?: Json;
}

export interface RunLogData {
  readonly schema: "benchpilot.run-log";
  readonly version: 1;
  readonly runId: string;
  readonly log: string;
}

export interface RunArtifactsData {
  readonly schema: "benchpilot.run-artifacts";
  readonly version: 1;
  readonly runId: string;
  readonly artifacts: readonly string[];
}

const displayWidth = (value: string) =>
  [...value].reduce(
    (width, character) => width + (character.codePointAt(0)! > 0xff ? 2 : 1),
    0,
  );

const pad = (value: string, width: number) =>
  `${value}${" ".repeat(Math.max(1, width - displayWidth(value)))}`;

const asRecord = (value: unknown): JsonRecord =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};

const optionalString = (value: unknown) =>
  typeof value === "string" ? value : undefined;

const optionalNumber = (value: unknown) =>
  typeof value === "number" ? value : undefined;

const summary = (id: string, manifest: JsonRecord): RunSummaryData => ({
  id,
  ...(optionalString(manifest.status)
    ? { status: String(manifest.status) }
    : {}),
  ...(optionalString(manifest.command)
    ? { command: String(manifest.command) }
    : {}),
  timing: {
    ...(optionalString(manifest.startedAt)
      ? { startedAt: String(manifest.startedAt) }
      : {}),
    ...(optionalString(manifest.endedAt)
      ? { endedAt: String(manifest.endedAt) }
      : {}),
    ...(optionalNumber(manifest.durationMs)
      ? { durationMs: Number(manifest.durationMs) }
      : {}),
  },
});

const row = (
  label: string,
  value: string | number,
  theme: TerminalTheme,
  format: (value: string) => string = theme.argument,
): CliScreenNode => ({
  text: `${theme.muted(pad(label, 12))}${format(String(value))}`,
});

const section = (
  title: string,
  children: readonly CliScreenNode[],
  theme: TerminalTheme,
): CliScreenNode => ({ text: theme.heading(title), children });

const statusLabel = (
  status: string | undefined,
  context: DataScreenContext,
) => {
  if (status === "succeeded") return t(context.locale, "run.status.succeeded");
  if (status === "failed") return t(context.locale, "run.status.failed");
  if (status === "aborted") return t(context.locale, "run.status.aborted");
  if (status === "running") return t(context.locale, "run.status.running");
  return status || t(context.locale, "run.status.unknown");
};

const statusText = (status: string | undefined, context: DataScreenContext) => {
  const theme = terminalTheme(context.color);
  const label = statusLabel(status, context);
  if (status === "succeeded") return theme.success(label);
  if (status === "failed" || status === "aborted") return theme.error(label);
  if (status === "running") return theme.warning(label);
  return theme.debug(label);
};

export const runListDataPage = (input: {
  readonly runs: readonly { id: string; manifest?: Json }[];
}): CliDataPage<RunListData> => {
  const data: RunListData = {
    schema: "benchpilot.run-list",
    version: 1,
    runs: input.runs.map((run) => summary(run.id, asRecord(run.manifest))),
  };
  return {
    data,
    screen: (context) => {
      const theme = terminalTheme(context.color);
      const idWidth = Math.max(
        34,
        displayWidth(t(context.locale, "run.list.id")) + 2,
        ...data.runs.map((run) => displayWidth(run.id) + 2),
      );
      const rows: readonly CliScreenNode[] = data.runs.length
        ? [
            {
              text: `${theme.muted(pad(t(context.locale, "run.list.id"), idWidth))}${theme.muted(pad(t(context.locale, "run.list.status"), 10))}${theme.muted(t(context.locale, "run.list.command"))}`,
            },
            ...data.runs.map((run) => ({
              text: `${theme.command(pad(run.id, idWidth))}${statusText(run.status, context)}${" ".repeat(Math.max(1, 10 - displayWidth(statusLabel(run.status, context))))}${theme.argument(run.command || "—")}`,
            })),
          ]
        : [{ text: theme.muted(t(context.locale, "run.list.none")) }];
      return [section(t(context.locale, "run.list.title"), rows, theme)];
    },
    jsonl: data.runs.map((run) => ({
      key: `runs.${run.id}`,
      value: run,
    })),
  };
};

export const runDetailDataPage = (input: {
  readonly manifest?: Json;
  readonly result?: Json;
}): CliDataPage<RunDetailData> => {
  const manifest = asRecord(input.manifest);
  const run = summary(String(manifest.runId || ""), manifest);
  const data: RunDetailData = {
    schema: "benchpilot.run-detail",
    version: 1,
    run: {
      ...run,
      environment: {
        ...(optionalString(manifest.hostname)
          ? { hostname: String(manifest.hostname) }
          : {}),
        ...(optionalNumber(manifest.pid) ? { pid: Number(manifest.pid) } : {}),
        ...(optionalString(manifest.platform)
          ? { platform: String(manifest.platform) }
          : {}),
      },
    },
    ...(input.result === undefined ? {} : { result: input.result }),
  };
  return {
    data,
    screen: (context) => {
      const theme = terminalTheme(context.color);
      const overview = [
        row(
          t(context.locale, "run.detail.id"),
          data.run.id,
          theme,
          theme.command,
        ),
        row(
          t(context.locale, "run.detail.status"),
          statusLabel(data.run.status, context),
          theme,
          () => statusText(data.run.status, context),
        ),
        ...(data.run.command
          ? [
              row(
                t(context.locale, "run.detail.command"),
                data.run.command,
                theme,
                theme.command,
              ),
            ]
          : []),
      ];
      const timing = [
        ...(data.run.timing.startedAt
          ? [
              row(
                t(context.locale, "run.detail.startedAt"),
                data.run.timing.startedAt,
                theme,
                theme.debug,
              ),
            ]
          : []),
        ...(data.run.timing.endedAt
          ? [
              row(
                t(context.locale, "run.detail.endedAt"),
                data.run.timing.endedAt,
                theme,
                theme.debug,
              ),
            ]
          : []),
        ...(data.run.timing.durationMs !== undefined
          ? [
              row(
                t(context.locale, "run.detail.duration"),
                `${data.run.timing.durationMs} ms`,
                theme,
                theme.debug,
              ),
            ]
          : []),
      ];
      const environment = [
        ...(data.run.environment.hostname
          ? [
              row(
                t(context.locale, "run.detail.host"),
                data.run.environment.hostname,
                theme,
              ),
            ]
          : []),
        ...(data.run.environment.pid !== undefined
          ? [
              row(
                t(context.locale, "run.detail.process"),
                data.run.environment.pid,
                theme,
              ),
            ]
          : []),
        ...(data.run.environment.platform
          ? [
              row(
                t(context.locale, "run.detail.platform"),
                data.run.environment.platform,
                theme,
              ),
            ]
          : []),
      ];
      return [
        section(t(context.locale, "run.detail.title"), overview, theme),
        ...(timing.length
          ? [section(t(context.locale, "run.detail.timing"), timing, theme)]
          : []),
        ...(environment.length
          ? [
              section(
                t(context.locale, "run.detail.environment"),
                environment,
                theme,
              ),
            ]
          : []),
      ];
    },
  };
};

export const runLogDataPage = (input: {
  readonly runId: string;
  readonly log: string;
}): CliDataPage<RunLogData> => ({
  data: { schema: "benchpilot.run-log", version: 1, ...input },
  screen: () => [{ text: input.log }],
});

export const runArtifactsDataPage = (input: {
  readonly runId: string;
  readonly artifacts: readonly string[];
}): CliDataPage<RunArtifactsData> => {
  const data: RunArtifactsData = {
    schema: "benchpilot.run-artifacts",
    version: 1,
    ...input,
  };
  return {
    data,
    screen: (context) => {
      const theme = terminalTheme(context.color);
      return [
        section(
          t(context.locale, "run.artifacts.title"),
          input.artifacts.length
            ? input.artifacts.map((artifact) => ({
                text: theme.argument(artifact),
              }))
            : [{ text: theme.muted(t(context.locale, "run.artifacts.none")) }],
          theme,
        ),
      ];
    },
    jsonl: data.artifacts.map((artifact) => ({
      key: `artifacts.${artifact}`,
      value: { name: artifact },
    })),
  };
};
